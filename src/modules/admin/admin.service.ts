import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as os from 'os';
import { Repository, MoreThan } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { SubscriptionEntity } from '../billing/entities/subscription.entity';
import { PlanEntity } from '../billing/entities/plan.entity';
import { AiRequestLogEntity } from '../ai/entities/ai-request-log.entity';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BackgroundJobEntity } from '../jobs/entities/background-job.entity';
import { SupportTicketEntity } from './entities/support-ticket.entity';
import { SecurityIncidentEntity } from './entities/security-incident.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cross-tenant aggregation for the Assembly overview surfaces (Dashboard,
 * Executive Command, Monitoring/Observability, and the platform activity
 * feed). All reads are platform-wide — there is intentionally no tenant
 * scoping here; access is gated by PlatformRoleGuard at the controller.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(MembershipEntity)
    private readonly memberships: Repository<MembershipEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(AiRequestLogEntity)
    private readonly aiLogs: Repository<AiRequestLogEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    @InjectRepository(BackgroundJobEntity)
    private readonly jobs: Repository<BackgroundJobEntity>,
    @InjectRepository(SupportTicketEntity)
    private readonly tickets: Repository<SupportTicketEntity>,
    @InjectRepository(SecurityIncidentEntity)
    private readonly incidents: Repository<SecurityIncidentEntity>,
  ) {}

  /** Headline counters + key sub-metrics for the main admin dashboard. */
  async dashboardOverview() {
    const since24h = new Date(Date.now() - DAY_MS);
    const since7d = new Date(Date.now() - 7 * DAY_MS);

    const [
      totalOrgs,
      totalUsers,
      activeUsers,
      newUsers24h,
      activeSubs,
      aiRequests24h,
      aiFailures24h,
      openTickets,
      openIncidents,
      runningJobs,
      failedJobs,
    ] = await Promise.all([
      this.orgs.count(),
      this.users.count(),
      this.users.count({ where: { status: 'active' } }),
      this.users.count({ where: { createdAt: MoreThan(since24h) } }),
      this.subscriptions.count({ where: { status: 'active' } }),
      this.aiLogs.count({ where: { createdAt: MoreThan(since24h) } }),
      this.aiLogs.count({
        where: { status: 'failed', createdAt: MoreThan(since24h) },
      }),
      this.tickets.count({ where: { status: 'open' } }),
      this.incidents.count({ where: { status: 'open' } }),
      this.jobs.count({ where: { status: 'active' } }),
      this.jobs.count({
        where: { status: 'failed', createdAt: MoreThan(since7d) },
      }),
    ]);

    const mrrCents = await this.estimateMrrCents();

    return {
      organizations: { total: totalOrgs },
      users: { total: totalUsers, active: activeUsers, new24h: newUsers24h },
      subscriptions: { active: activeSubs },
      revenue: { mrrCents, currency: 'USD' },
      ai: { requests24h: aiRequests24h, failures24h: aiFailures24h },
      support: { openTickets },
      security: { openIncidents },
      jobs: { running: runningJobs, failed7d: failedJobs },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Strategic KPIs + a 30-day signups trend for the Executive Command Center. */
  async executiveKpis() {
    const since30d = new Date(Date.now() - 30 * DAY_MS);
    const since60d = new Date(Date.now() - 60 * DAY_MS);

    const [signups30d, signupsPrev30d, mrrCents, activeOrgs] =
      await Promise.all([
        this.users.count({ where: { createdAt: MoreThan(since30d) } }),
        this.users
          .createQueryBuilder('u')
          .where('u.createdAt > :start AND u.createdAt <= :end', {
            start: since60d,
            end: since30d,
          })
          .getCount(),
        this.estimateMrrCents(),
        this.orgs.count({ where: { status: 'active' } }),
      ]);

    const growthPct =
      signupsPrev30d === 0
        ? null
        : Math.round(
            ((signups30d - signupsPrev30d) / signupsPrev30d) * 1000,
          ) / 10;

    return {
      mrrCents,
      arrCents: mrrCents * 12,
      currency: 'USD',
      activeOrganizations: activeOrgs,
      signups30d,
      signupsPrev30d,
      signupGrowthPct: growthPct,
      signupTrend: await this.signupTrend(30),
    };
  }

  /** Daily signup counts for the last `days` days (oldest → newest). */
  async signupTrend(days: number) {
    const rows = await this.users
      .createQueryBuilder('u')
      .select("date_trunc('day', u.createdAt)", 'day')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt > :since', {
        since: new Date(Date.now() - days * DAY_MS),
      })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: Date; count: string }>();
    return rows.map((r) => ({
      day: new Date(r.day).toISOString().slice(0, 10),
      count: Number(r.count),
    }));
  }

  /** Live process/host health for the Observability Center (real metrics). */
  observabilitySnapshot() {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const load = os.loadavg();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      load: { '1m': load[0], '5m': load[1], '15m': load[2] },
      cpuCount: os.cpus().length,
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        hostTotalBytes: totalMem,
        hostFreeBytes: freeMem,
        hostUsedPct: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
      },
      node: process.version,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Cross-tenant activity/notifications feed (most recent audit events). */
  async activityFeed(limit = 50) {
    const rows = await this.auditLogs.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      origin: r.origin,
      organizationId: r.organizationId,
      actorUserId: r.actorUserId,
      createdAt: r.createdAt,
      metadata: r.metadata,
    }));
  }

  /**
   * Rough MRR estimate: sum of monthly-equivalent plan price across active
   * paid subscriptions. Yearly subs are amortised to a monthly figure.
   * This is a real number derived from real subscriptions — not a mock —
   * though true revenue should ultimately come from the payment provider.
   */
  private async estimateMrrCents(): Promise<number> {
    const subs = await this.subscriptions.find({ where: { status: 'active' } });
    if (subs.length === 0) return 0;
    const planById = new Map<string, PlanEntity>();
    for (const plan of await this.plans.find()) planById.set(plan.id, plan);

    let total = 0;
    for (const sub of subs) {
      const plan = planById.get(sub.planId);
      if (!plan) continue;
      const seats = plan.perSeat ? Math.max(1, sub.seats) : 1;
      const monthly =
        sub.interval === 'yearly'
          ? Math.round(plan.yearlyPriceCents / 12)
          : plan.monthlyPriceCents;
      total += monthly * seats;
    }
    return total;
  }
}
