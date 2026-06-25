import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { Brackets, Repository } from 'typeorm';
import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { PlanEntity } from '../../billing/entities/plan.entity';
import { SubscriptionEntity } from '../../billing/entities/subscription.entity';
import { UsageCounterEntity } from '../../billing/entities/usage-counter.entity';
import { MembershipEntity } from '../../memberships/entities/membership.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Injectable()
export class AdminCustomersService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgsRepo: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(MembershipEntity)
    private readonly membershipsRepo: Repository<MembershipEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly plansRepo: Repository<PlanEntity>,
    @InjectRepository(UsageCounterEntity)
    private readonly countersRepo: Repository<UsageCounterEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Search organizations and users by name / slug / email. */
  async search(term: string) {
    const q = `%${(term ?? '').trim()}%`;
    const orgs = await this.orgsRepo
      .createQueryBuilder('o')
      .where(
        new Brackets((b) => {
          b.where('o.name ILIKE :q', { q })
            .orWhere('o.slug ILIKE :q', { q })
            .orWhere('CAST(o.id AS TEXT) = :exact', { exact: term });
        }),
      )
      .orderBy('o.createdAt', 'DESC')
      .take(25)
      .getMany();

    const users = await this.usersRepo
      .createQueryBuilder('u')
      .where('u.email ILIKE :q OR u.first_name ILIKE :q OR u.last_name ILIKE :q', {
        q,
      })
      .orderBy('u.createdAt', 'DESC')
      .take(25)
      .getMany();

    return {
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        createdAt: o.createdAt,
      })),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        status: u.status,
        emailVerifiedAt: u.emailVerifiedAt,
      })),
    };
  }

  /** Full customer (organization) profile for the support detail view. */
  async getOrganizationDetail(organizationId: string) {
    const org = await this.orgsRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found.');

    const owner = await this.usersRepo.findOne({
      where: { id: org.ownerUserId },
    });

    const memberships = await this.membershipsRepo.find({
      where: { organizationId },
    });
    const memberUserIds = [...new Set(memberships.map((m) => m.userId))];

    const subscription = await this.subscriptionsRepo.findOne({
      where: { organizationId },
    });
    const plan = subscription
      ? await this.plansRepo.findOne({ where: { id: subscription.planId } })
      : null;

    const usage = await this.countersRepo.find({ where: { organizationId } });

    const recentActivity = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.organizationId = :organizationId', { organizationId })
      .orderBy('a.createdAt', 'DESC')
      .take(25)
      .getMany();

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        description: org.description,
        createdAt: org.createdAt,
      },
      owner: owner
        ? {
            id: owner.id,
            email: owner.email,
            firstName: owner.firstName,
            lastName: owner.lastName,
            status: owner.status,
            emailVerifiedAt: owner.emailVerifiedAt,
          }
        : null,
      memberCount: memberUserIds.length,
      subscription,
      plan: plan
        ? { tier: plan.tier, name: plan.name, monthlyPriceCents: plan.monthlyPriceCents, currency: plan.currency }
        : null,
      usage: usage.map((u) => ({
        metric: u.metric,
        period: u.period,
        count: u.count,
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        action: a.action,
        actorUserId: a.actorUserId,
        targetType: a.targetType,
        origin: a.origin,
        createdAt: a.createdAt,
      })),
    };
  }

  async setOrganizationStatus(organizationId: string, status: string) {
    const org = await this.orgsRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found.');
    org.status = status;
    await this.orgsRepo.save(org);
    return { id: org.id, status: org.status };
  }

  /**
   * Reset a customer's password to a freshly generated temporary one, returned
   * ONCE to the staff member to relay to the customer. The customer should
   * change it after signing in.
   */
  async resetUserPassword(userId: string): Promise<{ tempPassword: string }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const tempPassword = `S62-${crypto.randomBytes(9).toString('base64url')}`;
    user.passwordHash = await argon2.hash(tempPassword);
    await this.usersRepo.save(user);
    return { tempPassword };
  }

  /** Mark a customer's email as verified (support override for stuck signups). */
  async markEmailVerified(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
    user.emailVerificationToken = null;
    await this.usersRepo.save(user);
    return { id: user.id, emailVerifiedAt: user.emailVerifiedAt };
  }

  /**
   * Issue a TIME-BOXED impersonation token so support can see a customer's
   * account to reproduce an issue. Signed with the customer JWT secret (so the
   * customer app accepts it) but short-lived and carrying an `impersonatedBy`
   * claim for traceability. Every issue is audited by the controller.
   */
  async issueImpersonationToken(
    userId: string,
    staffId: string,
  ): Promise<{ token: string; expiresInSeconds: number; user: object }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const expiresInSeconds = 15 * 60;
    const token = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        impersonatedBy: staffId,
      },
      {
        secret: this.configService.get<string>(
          'JWT_SECRET',
          'stack62-local-development-secret',
        ),
        expiresIn: expiresInSeconds,
      },
    );
    return {
      token,
      expiresInSeconds,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
