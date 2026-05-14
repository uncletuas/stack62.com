import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { SlackBridgeService } from './slack-bridge.service';

/**
 * Slack Events API receiver. Slack POSTs JSON to /v1/slack/events; we
 * verify the signature using SLACK_SIGNING_SECRET, then route by event
 * type. URL verification (the initial handshake when you configure the
 * Events endpoint at api.slack.com) is handled inline by returning the
 * `challenge` field.
 */
@Injectable()
export class SlackEventsService {
  private readonly logger = new Logger(SlackEventsService.name);

  constructor(
    private readonly bridge: SlackBridgeService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verifies the Slack request signature per
   * https://api.slack.com/authentication/verifying-requests-from-slack
   *
   * Throws BadRequestException on any mismatch / replay.
   */
  verifySignature(
    rawBody: string,
    timestamp: string | undefined,
    signature: string | undefined,
  ): void {
    const secret = this.configService.get<string>('SLACK_SIGNING_SECRET');
    if (!secret) {
      throw new BadRequestException(
        'Slack signing secret not configured — refusing request.',
      );
    }
    if (!timestamp || !signature) {
      throw new BadRequestException('Slack signature headers missing.');
    }
    const ts = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) {
      throw new BadRequestException('Slack request timestamp out of range.');
    }
    const basestring = `v0:${timestamp}:${rawBody}`;
    const computed =
      'v0=' +
      crypto.createHmac('sha256', secret).update(basestring).digest('hex');
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new BadRequestException('Slack signature mismatch.');
    }
  }

  async handlePayload(body: Record<string, unknown>): Promise<unknown> {
    // URL verification handshake — done once when registering the endpoint.
    if (body.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    if (body.type !== 'event_callback' || !body.event) {
      return { ok: true };
    }

    const event = body.event as Record<string, unknown>;
    const teamId = String(body.team_id || event.team || '');

    if (event.type === 'message' && !event.subtype) {
      await this.bridge.handleInboundMessage({
        teamId,
        channelId: String(event.channel || ''),
        userId: String(event.user || ''),
        text: String(event.text || ''),
        ts: String(event.ts || ''),
        threadTs:
          typeof event.thread_ts === 'string' ? event.thread_ts : undefined,
        botId: typeof event.bot_id === 'string' ? event.bot_id : undefined,
      });
    } else {
      this.logger.debug(`Ignoring Slack event ${String(event.type)}`);
    }

    return { ok: true };
  }
}
