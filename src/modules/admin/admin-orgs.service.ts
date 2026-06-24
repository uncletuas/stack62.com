import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { SubscriptionEntity } from '../billing/entities/subscription.entity';
import { PlanEntity } from '../billing/entities/plan.entity';

export interface AdminOrgListQuery {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** Cross-tenant organization administration for the Org Management module. */
@Injectable()
export class AdminOrgsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(MembershipEntity)
    private readonly memberships: Repository<MembershipEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminOrgListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const qb = this.orgs.createQueryBuilder('o');
    if (query.search) {
      const term = `%${query.search}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('o.name ILIKE :term', { term }).orWhere(
            'o.slug ILIKE :term',
            { term },
          );
        }),
      );
    }
    if (query.status) qb.andWhere('o.status = :status', { status: query.status });

    const [rows, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    // Attach member counts + plan tier in a couple of batched queries.
    const ids = rows.map((o) => o.id);
    const memberCounts = await this.memberCountsFor(ids);
    const planByOrg = await this.planTierFor(ids);

    return {
      items: rows.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        ownerUserId: o.ownerUserId,
        memberCount: memberCounts.get(o.id) ?? 0,
        planTier: planByOrg.get(o.id) ?? 'free',
        createdAt: o.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(orgId: string) {
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found.');
    const memberCount = await this.memberships.count({
      where: { organizationId: orgId },
    });
    const sub = await this.subscriptions.findOne({
      where: { organizationId: orgId },
    });
    const plan = sub
      ? await this.plans.findOne({ where: { id: sub.planId } })
      : null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      status: org.status,
      ownerUserId: org.ownerUserId,
      preferredModel: org.preferredModel,
      memberCount,
      subscription: sub
        ? {
            status: sub.status,
            interval: sub.interval,
            seats: sub.seats,
            planTier: plan?.tier ?? 'free',
            planName: plan?.name ?? 'Free',
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      createdAt: org.createdAt,
    };
  }

  async setStatus(orgId: string, status: string, actorUserId: string) {
    const org = await this.orgs.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found.');
    const before = org.status;
    org.status = status;
    await this.orgs.save(org);
    await this.audit.log({
      organizationId: orgId,
      actorUserId,
      action: 'admin.org.set_status',
      targetType: 'organization',
      targetId: orgId,
      origin: 'user',
      beforeData: { status: before },
      afterData: { status },
    });
    return this.get(orgId);
  }

  private async memberCountsFor(orgIds: string[]) {
    const map = new Map<string, number>();
    if (orgIds.length === 0) return map;
    const rows = await this.memberships
      .createQueryBuilder('m')
      .select('m.organizationId', 'orgId')
      .addSelect('COUNT(*)', 'count')
      .where('m.organizationId IN (:...orgIds)', { orgIds })
      .groupBy('m.organizationId')
      .getRawMany<{ orgId: string; count: string }>();
    for (const r of rows) map.set(r.orgId, Number(r.count));
    return map;
  }

  private async planTierFor(orgIds: string[]) {
    const map = new Map<string, string>();
    if (orgIds.length === 0) return map;
    const subs = await this.subscriptions.find({
      where: { organizationId: In(orgIds) },
    });
    const planById = new Map(
      (await this.plans.find()).map((p) => [p.id, p.tier]),
    );
    for (const s of subs) {
      map.set(s.organizationId, planById.get(s.planId) ?? 'free');
    }
    return map;
  }
}
