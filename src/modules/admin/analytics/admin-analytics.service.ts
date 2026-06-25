import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentTransactionEntity } from '../../billing/entities/payment-transaction.entity';
import { PlanEntity } from '../../billing/entities/plan.entity';
import { SubscriptionEntity } from '../../billing/entities/subscription.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { UserEntity } from '../../users/entities/user.entity';

export interface Bucket {
  date: string;
  count: number;
}

/**
 * Business analytics for the ops console: growth, revenue, plan mix and
 * geography. Revenue is REAL (sum of successful payment_transactions written by
 * the Paystack webhook); MRR is the recurring estimate from active
 * subscriptions × plan price. Time-series use Postgres date_trunc.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgsRepo: Repository<OrganizationEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly plansRepo: Repository<PlanEntity>,
    @InjectRepository(PaymentTransactionEntity)
    private readonly txRepo: Repository<PaymentTransactionEntity>,
  ) {}

  async overview() {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalOrgs, activeSubs, newUsers30, newOrgs30] =
      await Promise.all([
        this.usersRepo.count(),
        this.orgsRepo.count(),
        this.subsRepo.count({ where: { status: 'active' } }),
        this.usersRepo
          .createQueryBuilder('u')
          .where('u.created_at >= :since', { since: since30 })
          .getCount(),
        this.orgsRepo
          .createQueryBuilder('o')
          .where('o.created_at >= :since', { since: since30 })
          .getCount(),
      ]);

    const mrr = await this.computeMrrCents();

    const revenueAllTime = await this.sumRevenue();
    const revenue30 = await this.sumRevenue(since30);
    const paymentsCount = await this.txRepo.count({
      where: { status: 'success' },
    });

    return {
      totals: {
        users: totalUsers,
        organizations: totalOrgs,
        activeSubscriptions: activeSubs,
      },
      last30Days: { newUsers: newUsers30, newOrganizations: newOrgs30 },
      recurring: { mrrCents: mrr.cents, arrCents: mrr.cents * 12, currency: mrr.currency },
      revenue: {
        allTimeMinor: revenueAllTime.amount,
        last30DaysMinor: revenue30.amount,
        currency: revenueAllTime.currency,
        successfulPayments: paymentsCount,
      },
    };
  }

  /** Daily signups + new orgs over a window (default 90 days). */
  async growth(days = 90): Promise<{ users: Bucket[]; organizations: Bucket[] }> {
    const [users, organizations] = await Promise.all([
      this.dailyCounts('users', days),
      this.dailyCounts('organizations', days),
    ]);
    return { users, organizations };
  }

  /** Monthly collected revenue (last 12 months) + plan distribution. */
  async revenue() {
    const rows = await this.txRepo.query(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
              currency,
              SUM(amount)::bigint AS total
         FROM payment_transactions
        WHERE status = 'success'
          AND created_at >= (now() - interval '12 months')
        GROUP BY 1, 2
        ORDER BY 1 ASC`,
    );
    const monthly = (rows as { month: string; currency: string; total: string }[]).map(
      (r) => ({ month: r.month, currency: r.currency, amountMinor: Number(r.total) }),
    );

    const plans = await this.plansRepo.find();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const subRows = await this.subsRepo
      .createQueryBuilder('s')
      .select('s.plan_id', 'planId')
      .addSelect('COUNT(*)', 'count')
      .where("s.status = 'active'")
      .groupBy('s.plan_id')
      .getRawMany<{ planId: string; count: string }>();

    const planDistribution = subRows.map((r) => ({
      tier: planById.get(r.planId)?.tier ?? 'unknown',
      name: planById.get(r.planId)?.name ?? 'unknown',
      activeSubscriptions: Number(r.count),
    }));

    return { monthly, planDistribution };
  }

  /** Users and organizations grouped by country (null = unknown). */
  async regions() {
    const usersByCountry = await this.groupByCountry('users');
    const orgsByCountry = await this.groupByCountry('organizations');
    return { usersByCountry, organizationsByCountry: orgsByCountry };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async dailyCounts(table: string, days: number): Promise<Bucket[]> {
    const rows = await this.usersRepo.query(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS count
         FROM ${table}
        WHERE created_at >= (now() - ($1 || ' days')::interval)
        GROUP BY 1
        ORDER BY 1 ASC`,
      [days],
    );
    return (rows as { date: string; count: number }[]).map((r) => ({
      date: r.date,
      count: Number(r.count),
    }));
  }

  private async groupByCountry(table: string) {
    const rows = await this.usersRepo.query(
      `SELECT COALESCE(country, 'Unknown') AS country, COUNT(*)::int AS count
         FROM ${table}
        GROUP BY 1
        ORDER BY 2 DESC`,
    );
    return (rows as { country: string; count: number }[]).map((r) => ({
      country: r.country,
      count: Number(r.count),
    }));
  }

  private async sumRevenue(
    since?: Date,
  ): Promise<{ amount: number; currency: string }> {
    const qb = this.txRepo
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .addSelect('MIN(t.currency)', 'currency')
      .where("t.status = 'success'");
    if (since) qb.andWhere('t.created_at >= :since', { since });
    const row = await qb.getRawOne<{ total: string; currency: string | null }>();
    return {
      amount: Number(row?.total ?? 0),
      currency: row?.currency ?? 'NGN',
    };
  }

  /** Monthly-equivalent recurring revenue from active subscriptions, in minor units. */
  private async computeMrrCents(): Promise<{ cents: number; currency: string }> {
    const subs = await this.subsRepo.find({ where: { status: 'active' } });
    const plans = await this.plansRepo.find();
    const planById = new Map(plans.map((p) => [p.id, p]));
    let cents = 0;
    let currency = 'USD';
    for (const sub of subs) {
      const plan = planById.get(sub.planId);
      if (!plan) continue;
      currency = plan.currency || currency;
      const monthly =
        sub.interval === 'yearly'
          ? Math.round((plan.yearlyPriceCents || 0) / 12)
          : plan.monthlyPriceCents || 0;
      cents += monthly * (plan.perSeat ? Math.max(1, sub.seats) : 1);
    }
    return { cents, currency };
  }
}
