import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { SecretEncryptionService } from '../../shared/crypto/secret-encryption.service';
import { UsersService } from '../users/users.service';
import { RoomMessageEntity } from '../rooms/entities/room-message.entity';
import { RoomEntity } from '../rooms/entities/room.entity';
import { RoomsService } from '../rooms/rooms.service';
import { SlackChannelMappingEntity } from './entities/slack-channel-mapping.entity';
import { SlackInstallationEntity } from './entities/slack-installation.entity';
import { SlackMessageLinkEntity } from './entities/slack-message-link.entity';

/**
 * Bidirectional Slack ↔ Stack62 bridge.
 *
 * Outbound (Stack62 → Slack):
 *   RoomsService.postMessage emits the new message; the calling
 *   controller invokes `bridgeOutbound` (post-save). We chat.postMessage
 *   to every active mapping for the room.
 *
 * Inbound (Slack → Stack62):
 *   SlackEventsController.handleEvent validates the signature, then
 *   forwards `message` events here. We look up the channel mapping,
 *   resolve the author, and call `RoomsService.postMessage`. The
 *   service then triggers the outbound path again — but the message
 *   we just inserted has a `slack_ts` link, so the outbound check
 *   skips it (idempotency).
 */
@Injectable()
export class SlackBridgeService {
  private readonly logger = new Logger(SlackBridgeService.name);

  constructor(
    @InjectRepository(SlackInstallationEntity)
    private readonly installationsRepo: Repository<SlackInstallationEntity>,
    @InjectRepository(SlackChannelMappingEntity)
    private readonly mappingsRepo: Repository<SlackChannelMappingEntity>,
    @InjectRepository(SlackMessageLinkEntity)
    private readonly linksRepo: Repository<SlackMessageLinkEntity>,
    private readonly roomsService: RoomsService,
    private readonly usersService: UsersService,
    private readonly activityService: ActivityService,
    private readonly secretEncryption: SecretEncryptionService,
  ) {}

  /** Decrypt the stored bot token before each Slack API call. */
  private getBotToken(installation: SlackInstallationEntity): string {
    return this.secretEncryption.decrypt(installation.botAccessToken);
  }

  // ── Mapping management ──────────────────────────────────────────────

  async listMappings(organizationId: string) {
    return this.mappingsRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createMapping(
    payload: {
      organizationId: string;
      roomId: string;
      slackChannelId: string;
      slackChannelName?: string;
      direction?: SlackChannelMappingEntity['direction'];
    },
    actorUserId: string,
  ): Promise<SlackChannelMappingEntity> {
    const installation = await this.installationsRepo.findOne({
      where: { organizationId: payload.organizationId, active: true },
    });
    if (!installation) {
      throw new BadRequestException(
        'Slack is not connected for this organization yet — click "Add to Slack" first.',
      );
    }
    const existing = await this.mappingsRepo.findOne({
      where: {
        installationId: installation.id,
        slackChannelId: payload.slackChannelId,
      },
    });
    if (existing) {
      existing.roomId = payload.roomId;
      existing.direction = payload.direction ?? existing.direction;
      existing.slackChannelName =
        payload.slackChannelName ?? existing.slackChannelName;
      existing.enabled = true;
      return this.mappingsRepo.save(existing);
    }
    const mapping = this.mappingsRepo.create({
      organizationId: payload.organizationId,
      installationId: installation.id,
      roomId: payload.roomId,
      slackChannelId: payload.slackChannelId,
      slackChannelName: payload.slackChannelName ?? null,
      direction: payload.direction ?? 'bidirectional',
      enabled: true,
      createdByUserId: actorUserId,
    });
    return this.mappingsRepo.save(mapping);
  }

  async deleteMapping(mappingId: string) {
    const mapping = await this.mappingsRepo.findOne({
      where: { id: mappingId },
    });
    if (!mapping) throw new NotFoundException('Mapping not found.');
    await this.mappingsRepo.delete({ id: mappingId });
  }

  async listSlackChannels(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const installation = await this.installationsRepo.findOne({
      where: { organizationId, active: true },
    });
    if (!installation) return [];
    const response = await fetch(
      'https://slack.com/api/conversations.list?exclude_archived=true&limit=200&types=public_channel,private_channel',
      {
        headers: { Authorization: `Bearer ${this.getBotToken(installation)}` },
      },
    );
    const json = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string; is_private: boolean }>;
    };
    if (!json.ok) {
      this.logger.warn(`conversations.list failed: ${json.error}`);
      return [];
    }
    return (json.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.is_private,
    }));
  }

  // ── Outbound (Stack62 → Slack) ──────────────────────────────────────

  /**
   * Called after RoomsService.postMessage. Idempotent — if the message
   * was originally created by an inbound Slack event we skip the
   * outbound post so we don't echo it back.
   */
  async bridgeOutbound(message: RoomMessageEntity): Promise<void> {
    // Already mirrored from Slack? Skip.
    const link = await this.linksRepo.findOne({
      where: { roomMessageId: message.id },
    });
    if (link) return;

    const mappings = await this.mappingsRepo.find({
      where: { roomId: message.roomId, enabled: true },
    });
    if (mappings.length === 0) return;

    for (const mapping of mappings) {
      if (mapping.direction === 'slack_to_stack62') continue;
      const installation = await this.installationsRepo.findOne({
        where: { id: mapping.installationId, active: true },
      });
      if (!installation) continue;

      const author = await this.formatAuthor(message);
      try {
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.getBotToken(installation)}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            channel: mapping.slackChannelId,
            text: `${author}: ${message.body}`,
            unfurl_links: false,
          }),
        });
        const json = (await response.json()) as {
          ok: boolean;
          error?: string;
          ts?: string;
        };
        if (!json.ok || !json.ts) {
          this.logger.warn(
            `chat.postMessage failed for ${mapping.slackChannelId}: ${json.error}`,
          );
          continue;
        }
        await this.linksRepo.save(
          this.linksRepo.create({
            roomMessageId: message.id,
            slackChannelId: mapping.slackChannelId,
            slackMessageTs: json.ts,
            direction: 'outbound',
          }),
        );
      } catch (err) {
        this.logger.error(
          `Outbound bridge failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── Inbound (Slack → Stack62) ───────────────────────────────────────

  async handleInboundMessage(payload: {
    teamId: string;
    channelId: string;
    userId: string;
    text: string;
    ts: string;
    threadTs?: string;
    botId?: string;
  }): Promise<void> {
    if (!payload.text?.trim()) return;
    if (payload.botId) return; // ignore messages our bot itself sent

    // Dedup: if we already linked this ts (inbound or outbound), drop.
    const existing = await this.linksRepo.findOne({
      where: {
        slackChannelId: payload.channelId,
        slackMessageTs: payload.ts,
      },
    });
    if (existing) return;

    const installation = await this.installationsRepo.findOne({
      where: { teamId: payload.teamId, active: true },
    });
    if (!installation) return;
    const mapping = await this.mappingsRepo.findOne({
      where: {
        installationId: installation.id,
        slackChannelId: payload.channelId,
        enabled: true,
      },
    });
    if (!mapping || mapping.direction === 'stack62_to_slack') return;

    // Try to map the Slack user to a Stack62 user via email; fall back
    // to "external" if we can't (renders as Coworker authorKind for now).
    const stackUser = await this.resolveSlackUser(
      this.getBotToken(installation),
      payload.userId,
    );

    // Borrow installation owner as the actor for access checks on the
    // post path; the actual authorKind/userId is set below.
    const message = await this.roomsService.postMessage(
      mapping.roomId,
      {
        body: payload.text,
        attachments: stackUser
          ? null
          : [
              {
                kind: 'tool_call' as const,
                id: `slack:${payload.userId}`,
                label: 'External Slack user',
              },
            ],
      },
      stackUser?.id || installation.installedByUserId,
      // If we couldn't resolve them locally, mark as system to set
      // expectations — they aren't a Stack62 member.
      stackUser ? { authorKind: 'user' } : { authorKind: 'system' },
    );

    await this.linksRepo.save(
      this.linksRepo.create({
        roomMessageId: message.id,
        slackChannelId: payload.channelId,
        slackMessageTs: payload.ts,
        direction: 'inbound',
      }),
    );

    await this.activityService.log({
      organizationId: installation.organizationId,
      actorUserId: stackUser?.id || installation.installedByUserId,
      action: 'slack.inbound_message',
      targetType: 'room_message',
      targetId: message.id,
      origin: 'system',
      metadata: {
        slackChannel: payload.channelId,
        slackUser: payload.userId,
        mapped: Boolean(stackUser),
      },
    });
  }

  async unlinkInstallation(installationId: string) {
    const installation = await this.installationsRepo.findOne({
      where: { id: installationId },
    });
    if (!installation) return;
    installation.active = false;
    await this.installationsRepo.save(installation);
    await this.mappingsRepo.update(
      { installationId },
      { enabled: false },
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async resolveSlackUser(
    botToken: string,
    slackUserId: string,
  ): Promise<{ id: string } | null> {
    try {
      const response = await fetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
        { headers: { Authorization: `Bearer ${botToken}` } },
      );
      const json = (await response.json()) as {
        ok: boolean;
        user?: { profile?: { email?: string } };
      };
      const email = json.user?.profile?.email?.toLowerCase();
      if (!email) return null;
      const user = await this.usersService.findByEmail(email);
      return user ? { id: user.id } : null;
    } catch {
      return null;
    }
  }

  private async formatAuthor(message: RoomMessageEntity): Promise<string> {
    if (message.authorKind === 'coworker') return 'Stack62 Coworker';
    if (message.authorKind === 'system') return 'Stack62';
    if (message.authorUserId) {
      try {
        const user = await this.usersService.findById(message.authorUserId);
        return `${user.firstName} ${user.lastName}`.trim();
      } catch {
        /* fall through */
      }
    }
    return 'Stack62 user';
  }
}
