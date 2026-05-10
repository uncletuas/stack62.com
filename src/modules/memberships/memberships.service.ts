import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { UsersService } from '../users/users.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ListMembershipsDto } from './dto/list-memberships.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { OrgInviteEntity } from './entities/org-invite.entity';
import { MembershipEntity } from './entities/membership.entity';

@Injectable()
export class MembershipsService {
  constructor(
    @InjectRepository(MembershipEntity)
    private readonly membershipsRepository: Repository<MembershipEntity>,
    @InjectRepository(OrgInviteEntity)
    private readonly invitesRepository: Repository<OrgInviteEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly usersService: UsersService,
  ) {}

  async create(payload: CreateMembershipDto, actorUserId: string) {
    const membership = this.membershipsRepository.create({
      userId: payload.userId,
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      role: payload.role,
      status: 'active',
    });

    const createdMembership = await this.membershipsRepository.save(membership);

    await this.activityService.log({
      organizationId: createdMembership.organizationId,
      workspaceId: createdMembership.workspaceId,
      actorUserId,
      action: 'membership.create',
      targetType: 'membership',
      targetId: createdMembership.id,
      origin: 'user',
      metadata: {
        userId: createdMembership.userId,
        role: createdMembership.role,
      },
    });

    return createdMembership;
  }

  async inviteMember(payload: InviteMemberDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'membership',
      action: 'manage_memberships',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
    });

    const email = payload.email.toLowerCase();
    const role = payload.role ?? 'member';

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      const alreadyMember = await this.membershipsRepository.findOne({
        where: {
          userId: existingUser.id,
          organizationId: payload.organizationId,
          workspaceId: payload.workspaceId ?? undefined,
        },
      });
      if (alreadyMember && alreadyMember.status === 'active') {
        throw new BadRequestException('User is already a member.');
      }
      if (alreadyMember) {
        alreadyMember.status = 'active';
        alreadyMember.role = role;
        return {
          membership: await this.membershipsRepository.save(alreadyMember),
          invite: null,
        };
      }
      const membership = await this.create(
        {
          userId: existingUser.id,
          organizationId: payload.organizationId,
          workspaceId: payload.workspaceId,
          role,
        },
        actorUserId,
      );
      return { membership, invite: null };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.invitesRepository.delete({
      email,
      organizationId: payload.organizationId,
      status: 'pending',
    });

    const invite = this.invitesRepository.create({
      token,
      email,
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      role,
      invitedByUserId: actorUserId,
      status: 'pending',
      expiresAt,
    });

    const createdInvite = await this.invitesRepository.save(invite);

    await this.activityService.log({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      actorUserId,
      action: 'membership.invite',
      targetType: 'org_invite',
      targetId: createdInvite.id,
      origin: 'user',
      metadata: { email, role },
    });

    return {
      membership: null,
      invite: { id: createdInvite.id, email, role, token, expiresAt },
    };
  }

  async acceptInvite(payload: AcceptInviteDto, actorUserId: string) {
    const invite = await this.invitesRepository.findOne({
      where: { token: payload.token, status: 'pending' },
    });

    if (!invite)
      throw new NotFoundException('Invite not found or already used.');
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite has expired.');
    }

    const user = await this.usersService.findById(actorUserId);
    if (user.email.toLowerCase() !== invite.email) {
      throw new BadRequestException(
        'This invite was sent to a different email address.',
      );
    }

    const membership = await this.create(
      {
        userId: actorUserId,
        organizationId: invite.organizationId,
        workspaceId: invite.workspaceId ?? undefined,
        role: invite.role,
      },
      actorUserId,
    );

    invite.status = 'accepted';
    await this.invitesRepository.save(invite);

    return membership;
  }

  async removeMember(membershipId: string, actorUserId: string) {
    const membership = await this.membershipsRepository.findOne({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException('Membership not found.');

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'membership',
      action: 'manage_memberships',
      organizationId: membership.organizationId,
      workspaceId: membership.workspaceId ?? undefined,
    });

    membership.status = 'removed';
    const updated = await this.membershipsRepository.save(membership);

    await this.activityService.log({
      organizationId: membership.organizationId,
      workspaceId: membership.workspaceId,
      actorUserId,
      action: 'membership.remove',
      targetType: 'membership',
      targetId: membership.id,
      origin: 'user',
      metadata: { userId: membership.userId },
    });

    return updated;
  }

  async updateMembership(
    membershipId: string,
    payload: UpdateMembershipDto,
    actorUserId: string,
  ) {
    const membership = await this.membershipsRepository.findOne({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException('Membership not found.');

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'membership',
      action: 'manage_memberships',
      organizationId: membership.organizationId,
      workspaceId: membership.workspaceId ?? undefined,
    });

    if (payload.role) membership.role = payload.role;
    if (payload.status) membership.status = payload.status;

    return this.membershipsRepository.save(membership);
  }

  async findAll(filters: ListMembershipsDto, actorUserId: string) {
    const queryBuilder =
      this.membershipsRepository.createQueryBuilder('membership');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'membership',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.userId) {
      queryBuilder.andWhere('membership.userId = :userId', {
        userId: filters.userId,
      });
    }

    queryBuilder.andWhere("membership.status != 'removed'");

    return queryBuilder.orderBy('membership.createdAt', 'DESC').getMany();
  }

  /**
   * Public preview of an invite by token — used by the /invite/:token
   * page so the recipient sees who invited them, the org, and the role
   * before signing in or signing up.
   */
  async lookupInvite(token: string) {
    const invite = await this.invitesRepository.findOne({
      where: { token, status: 'pending' },
    });
    if (!invite) {
      throw new NotFoundException('Invite not found or already used.');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invite has expired.');
    }
    const inviter = await this.usersService.findById(invite.invitedByUserId);
    return {
      email: invite.email,
      role: invite.role,
      organizationId: invite.organizationId,
      workspaceId: invite.workspaceId,
      expiresAt: invite.expiresAt,
      invitedBy: inviter
        ? {
            firstName: inviter.firstName,
            lastName: inviter.lastName,
          }
        : null,
    };
  }

  async findPendingInvites(organizationId: string, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'membership',
      action: 'read',
      organizationId,
    });

    return this.invitesRepository.find({
      where: { organizationId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }
}
