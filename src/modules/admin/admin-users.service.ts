import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UserEntity } from '../users/entities/user.entity';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import {
  isPlatformRole,
  type PlatformRole,
} from '../../shared/access-control/platform-roles';

export interface AdminUserListQuery {
  search?: string;
  status?: string;
  platformRole?: string;
  page?: number;
  pageSize?: number;
}

/** Cross-tenant user administration for the User Management module. */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(MembershipEntity)
    private readonly memberships: Repository<MembershipEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminUserListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const qb = this.users.createQueryBuilder('u');
    if (query.search) {
      const term = `%${query.search}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.email ILIKE :term', { term })
            .orWhere('u.firstName ILIKE :term', { term })
            .orWhere('u.lastName ILIKE :term', { term });
        }),
      );
    }
    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.platformRole) {
      qb.andWhere('u.platformRole = :pr', { pr: query.platformRole });
    }

    const [rows, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: rows.map((u) => this.toSummary(u)),
      total,
      page,
      pageSize,
    };
  }

  async get(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const memberships = await this.memberships.find({ where: { userId } });
    const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
    const orgs = orgIds.length
      ? await this.orgs.find({ where: { id: In(orgIds) } })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    return {
      ...this.toSummary(user),
      memberships: memberships.map((m) => ({
        id: m.id,
        organizationId: m.organizationId,
        organizationName: orgById.get(m.organizationId)?.name ?? null,
        workspaceId: m.workspaceId,
        role: m.role,
        status: m.status,
      })),
    };
  }

  async setStatus(
    userId: string,
    status: 'active' | 'suspended',
    actorUserId: string,
  ) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const before = user.status;
    user.status = status;
    await this.users.save(user);
    await this.audit.log({
      actorUserId,
      action: status === 'suspended' ? 'admin.user.suspend' : 'admin.user.activate',
      targetType: 'user',
      targetId: userId,
      origin: 'user',
      beforeData: { status: before },
      afterData: { status },
    });
    return this.toSummary(user);
  }

  async verifyEmail(userId: string, actorUserId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
    await this.users.save(user);
    await this.audit.log({
      actorUserId,
      action: 'admin.user.verify_email',
      targetType: 'user',
      targetId: userId,
      origin: 'user',
    });
    return this.toSummary(user);
  }

  /** Assign/clear the platform (Assembly) role — the RBAC admin path. */
  async setPlatformRole(
    userId: string,
    platformRole: string | null,
    actorUserId: string,
  ) {
    if (platformRole !== null && !isPlatformRole(platformRole)) {
      throw new NotFoundException(`Unknown platform role: ${platformRole}`);
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const before = user.platformRole;
    user.platformRole = (platformRole as PlatformRole | null) ?? null;
    await this.users.save(user);
    await this.audit.log({
      actorUserId,
      action: 'admin.user.set_platform_role',
      targetType: 'user',
      targetId: userId,
      origin: 'user',
      beforeData: { platformRole: before },
      afterData: { platformRole: user.platformRole },
    });
    return this.toSummary(user);
  }

  /** List Loopital staff (anyone with a platform role) — Roles module. */
  async listStaff() {
    const rows = await this.users
      .createQueryBuilder('u')
      .where('u.platformRole IS NOT NULL')
      .orderBy('u.createdAt', 'DESC')
      .getMany();
    return rows.map((u) => this.toSummary(u));
  }

  private toSummary(user: UserEntity) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      platformRole: user.platformRole ?? null,
      emailVerifiedAt: user.emailVerifiedAt,
      avatarFileId: user.avatarFileId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
