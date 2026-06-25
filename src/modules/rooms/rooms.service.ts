import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { RoomMemberEntity } from './entities/room-member.entity';
import { RoomMessageEntity } from './entities/room-message.entity';
import { RoomEntity, RoomKind } from './entities/room.entity';

/**
 * Service for Coworker Rooms — the multi-human chat surface where the
 * Coworker is a first-class participant.
 *
 * Key invariant: a user can always "step out into a private Coworker
 * thread" from any room. We model that as a separate Room of kind
 * `coworker_private` per (user, organization). The UI toggle just
 * swaps which room is currently active.
 */
@Injectable()
export class RoomsService {
  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomsRepo: Repository<RoomEntity>,
    @InjectRepository(RoomMemberEntity)
    private readonly membersRepo: Repository<RoomMemberEntity>,
    @InjectRepository(RoomMessageEntity)
    private readonly messagesRepo: Repository<RoomMessageEntity>,
    @InjectRepository(MembershipEntity)
    private readonly orgMembershipsRepo: Repository<MembershipEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activityService: ActivityService,
  ) {}

  // ── Room creation ─────────────────────────────────────────────────────

  async createRoom(
    payload: {
      organizationId: string;
      workspaceId?: string | null;
      systemId?: string | null;
      kind: RoomKind;
      name?: string;
      topic?: string;
      memberUserIds?: string[];
      coworkerEnabled?: boolean;
    },
    actorUserId: string,
  ): Promise<RoomEntity> {
    if (payload.kind !== 'coworker_private' && !payload.name?.trim()) {
      throw new BadRequestException(
        'Channel / group / DM rooms must have a name.',
      );
    }

    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: payload.organizationId,
    });

    const room = await this.roomsRepo.save(
      this.roomsRepo.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        systemId: payload.systemId ?? null,
        kind: payload.kind,
        visibility: payload.kind === 'channel' ? 'public' : 'private',
        name: payload.name?.trim() || null,
        topic: payload.topic?.trim() || null,
        createdByUserId: actorUserId,
        coworkerEnabled: payload.coworkerEnabled ?? true,
        lastActivityAt: new Date(),
      }),
    );

    // The creator is always an owner.
    const memberIds = new Set([actorUserId, ...(payload.memberUserIds || [])]);
    await this.membersRepo.save(
      Array.from(memberIds).map((userId, idx) =>
        this.membersRepo.create({
          roomId: room.id,
          userId,
          role: userId === actorUserId ? 'owner' : 'member',
          lastReadAt: idx === 0 ? new Date() : null,
        }),
      ),
    );

    await this.activityService.log({
      organizationId: room.organizationId,
      workspaceId: room.workspaceId,
      actorUserId,
      action: 'room.create',
      targetType: 'room',
      targetId: room.id,
      origin: 'user',
      metadata: {
        kind: room.kind,
        name: room.name,
        memberCount: memberIds.size,
      },
    });

    return room;
  }

  /**
   * Find-or-create the user's private 1:1 Coworker room. This is what
   * the "step out into Coworker DM" toggle hits — we keep at most one
   * coworker_private room per (user, org).
   */
  async getOrCreatePrivateCoworkerRoom(
    organizationId: string,
    userId: string,
  ): Promise<RoomEntity> {
    await this.accessControl.assertResolvedAccess(userId, {
      resource: 'organization',
      action: 'read',
      organizationId,
    });

    const memberRows = await this.membersRepo.find({ where: { userId } });
    const candidateRoomIds = memberRows.map((m) => m.roomId);
    if (candidateRoomIds.length > 0) {
      const existing = await this.roomsRepo.findOne({
        where: {
          id: In(candidateRoomIds),
          organizationId,
          kind: 'coworker_private',
        },
      });
      if (existing) return existing;
    }

    return this.createRoom(
      {
        organizationId,
        kind: 'coworker_private',
        name: null as unknown as string,
        coworkerEnabled: true,
        memberUserIds: [userId],
      },
      userId,
    );
  }

  // ── Listing + reading ─────────────────────────────────────────────────

  async listMyRooms(
    organizationId: string,
    userId: string,
  ): Promise<RoomEntity[]> {
    const memberships = await this.membersRepo.find({ where: { userId } });
    const ids = memberships.map((m) => m.roomId);
    if (ids.length === 0) return [];
    return this.roomsRepo.find({
      where: { id: In(ids), organizationId },
      order: { lastActivityAt: 'DESC' },
    });
  }

  async listChannels(organizationId: string): Promise<RoomEntity[]> {
    return this.roomsRepo.find({
      where: { organizationId, kind: 'channel' },
      order: { name: 'ASC' },
    });
  }

  async getRoom(roomId: string, userId: string): Promise<RoomEntity> {
    const room = await this.roomsRepo.findOne({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found.');
    await this.assertReadAccess(room, userId);
    return room;
  }

  async listMembers(roomId: string, userId: string) {
    await this.getRoom(roomId, userId);
    return this.membersRepo.find({ where: { roomId } });
  }

  // ── Messages ──────────────────────────────────────────────────────────

  async listMessages(
    roomId: string,
    userId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<RoomMessageEntity[]> {
    await this.getRoom(roomId, userId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const qb = this.messagesRepo
      .createQueryBuilder('m')
      .where('m.roomId = :roomId', { roomId })
      .andWhere('m.deleted = false')
      .orderBy('m.createdAt', 'DESC')
      .limit(limit);
    if (opts.before) {
      qb.andWhere('m.createdAt < :before', { before: opts.before });
    }
    const rows = await qb.getMany();
    return rows.reverse();
  }

  async postMessage(
    roomId: string,
    payload: {
      body: string;
      parentMessageId?: string | null;
      mentions?: string[] | null;
      attachments?: RoomMessageEntity['attachments'];
    },
    userId: string,
    options: { authorKind?: 'user' | 'coworker' | 'system' } = {},
  ): Promise<RoomMessageEntity> {
    const room = await this.getRoom(roomId, userId);
    if (!payload.body?.trim() && !payload.attachments?.length) {
      throw new BadRequestException(
        'A message needs body text or at least one attachment.',
      );
    }

    const message = await this.messagesRepo.save(
      this.messagesRepo.create({
        roomId,
        authorKind: options.authorKind ?? 'user',
        authorUserId: options.authorKind === 'user' ? userId : null,
        body: (payload.body ?? '').trim(),
        parentMessageId: payload.parentMessageId ?? null,
        mentions: payload.mentions?.length ? payload.mentions : null,
        attachments: payload.attachments?.length ? payload.attachments : null,
      }),
    );

    room.lastActivityAt = new Date();
    await this.roomsRepo.save(room);

    return message;
  }

  async markRead(roomId: string, userId: string): Promise<void> {
    const member = await this.membersRepo.findOne({
      where: { roomId, userId },
    });
    if (!member) return;
    member.lastReadAt = new Date();
    await this.membersRepo.save(member);
  }

  // ── Members ───────────────────────────────────────────────────────────

  async addMember(
    roomId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<RoomMemberEntity> {
    const room = await this.getRoom(roomId, actorUserId);
    const actorMember = await this.requireMember(roomId, actorUserId);
    if (actorMember.role === 'member') {
      throw new ForbiddenException(
        'Only room owners or admins can invite members.',
      );
    }
    // Target user must already be in the org.
    const orgMembership = await this.orgMembershipsRepo.findOne({
      where: {
        userId: targetUserId,
        organizationId: room.organizationId,
        status: 'active',
      },
    });
    if (!orgMembership) {
      throw new BadRequestException(
        'That user is not a member of this organization.',
      );
    }
    const existing = await this.membersRepo.findOne({
      where: { roomId, userId: targetUserId },
    });
    if (existing) return existing;
    return this.membersRepo.save(
      this.membersRepo.create({
        roomId,
        userId: targetUserId,
        role: 'member',
      }),
    );
  }

  async removeMember(
    roomId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const actorMember = await this.requireMember(roomId, actorUserId);
    if (actorMember.role === 'member' && actorUserId !== targetUserId) {
      throw new ForbiddenException(
        'Only room owners or admins can remove other members.',
      );
    }
    await this.membersRepo.delete({ roomId, userId: targetUserId });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async assertReadAccess(
    room: RoomEntity,
    userId: string,
  ): Promise<void> {
    // Public channels: any org member.
    if (room.kind === 'channel' && room.visibility === 'public') {
      await this.accessControl.assertResolvedAccess(userId, {
        resource: 'organization',
        action: 'read',
        organizationId: room.organizationId,
      });
      return;
    }
    await this.requireMember(room.id, userId);
  }

  private async requireMember(
    roomId: string,
    userId: string,
  ): Promise<RoomMemberEntity> {
    const member = await this.membersRepo.findOne({
      where: { roomId, userId },
    });
    if (!member) {
      throw new ForbiddenException('You are not a member of this room.');
    }
    return member;
  }
}
