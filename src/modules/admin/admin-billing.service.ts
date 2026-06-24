import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionEntity } from '../billing/entities/subscription.entity';
import { PlanEntity } from '../billing/entities/plan.entity';

/** Read models for the Subscription & Revenue Management module. */
@Injectable()
export class AdminBillingService {
  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
  ) {}

  async listPlans() {
    return this.plans.find({ order: { sortOrder: 'ASC' } });
  }

  async listSubscriptions(query: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const qb = this.subscriptions.createQueryBuilder('s');
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    const [rows, total] = await qb
      .orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const planById = new Map(
      (await this.plans.find()).map((p) => [p.id, p]),
    );
    return {
      items: rows.map((s) => {
        const plan = planById.get(s.planId);
        return {
          id: s.id,
          organizationId: s.organizationId,
          status: s.status,
          interval: s.interval,
          seats: s.seats,
          planTier: plan?.tier ?? 'free',
          planName: plan?.name ?? 'Free',
          monthlyValueCents: this.monthlyValueCents(s, plan),
          currentPeriodEnd: s.currentPeriodEnd,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          createdAt: s.createdAt,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** Revenue analytics: MRR, ARR, and a breakdown by plan tier. */
  async revenueSummary() {
    const subs = await this.subscriptions.find({ where: { status: 'active' } });
    const planById = new Map((await this.plans.find()).map((p) => [p.id, p]));

    const byTier = new Map<string, { count: number; mrrCents: number }>();
    let mrrCents = 0;
    for (const s of subs) {
      const plan = planById.get(s.planId);
      const tier = plan?.tier ?? 'free';
      const value = this.monthlyValueCents(s, plan);
      mrrCents += value;
      const bucket = byTier.get(tier) ?? { count: 0, mrrCents: 0 };
      bucket.count += 1;
      bucket.mrrCents += value;
      byTier.set(tier, bucket);
    }

    return {
      currency: 'USD',
      mrrCents,
      arrCents: mrrCents * 12,
      activeSubscriptions: subs.length,
      byTier: [...byTier.entries()].map(([tier, v]) => ({ tier, ...v })),
    };
  }

  private monthlyValueCents(
    sub: SubscriptionEntity,
    plan: PlanEntity | undefined,
  ): number {
    if (!plan) return 0;
    const seats = plan.perSeat ? Math.max(1, sub.seats) : 1;
    const monthly =
      sub.interval === 'yearly'
        ? Math.round(plan.yearlyPriceCents / 12)
        : plan.monthlyPriceCents;
    return monthly * seats;
  }
}
