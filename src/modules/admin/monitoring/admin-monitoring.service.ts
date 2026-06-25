import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { BackgroundJobEntity } from '../../jobs/entities/background-job.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { SubscriptionEntity } from '../../billing/entities/subscription.entity';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * Read-only platform observability for the ops console: counts, DB health, the
 * background-job queue state, and an error feed assembled from failed jobs and
 * failed-login audit events (Sentry covers exceptions; this surfaces the
 * operational signals we own in the DB without an external API token).
 */
@Injectable()
export class AdminMonitoringService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgsRepo: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(BackgroundJobEntity)
    private readonly jobsRepo: Repository<BackgroundJobEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async overview() {
    const dbOk = await this.dataSource
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);

    const [organizations, users, activeSubscriptions] = await Promise.all([
      this.orgsRepo.count(),
      this.usersRepo.count(),
      this.subsRepo.count({ where: { status: 'active' } }),
    ]);

    const jobsByStatus = await this.jobsRepo
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('j.status')
      .getRawMany<{ status: string; count: string }>();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedJobs24h = await this.jobsRepo
      .createQueryBuilder('j')
      .where('j.status = :status', { status: 'failed' })
      .andWhere('j.created_at >= :since', { since })
      .getCount();

    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: { reachable: dbOk },
      counts: { organizations, users, activeSubscriptions },
      jobs: {
        byStatus: jobsByStatus.map((r) => ({
          status: r.status,
          count: Number(r.count),
        })),
        failedLast24h: failedJobs24h,
      },
    };
  }

  /** Recent failed background jobs, newest first. */
  async failedJobs(limit = 50) {
    const jobs = await this.jobsRepo.find({
      where: { status: 'failed' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return jobs.map((j) => ({
      id: j.id,
      queueName: j.queueName,
      jobType: j.jobType,
      organizationId: j.organizationId,
      errorMessage: j.errorMessage,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    }));
  }

  /** Operational error feed: failed jobs + failed logins, merged + sorted. */
  async errorFeed(limit = 50) {
    const jobs = await this.failedJobs(limit);
    const audit = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.action ILIKE :p', { p: '%fail%' })
      .orderBy('a.createdAt', 'DESC')
      .take(limit)
      .getMany();

    const events = [
      ...jobs.map((j) => ({
        kind: 'job_failure',
        at: j.createdAt,
        summary: `${j.queueName}/${j.jobType}: ${j.errorMessage ?? 'failed'}`,
        organizationId: j.organizationId,
      })),
      ...audit.map((a) => ({
        kind: 'audit_failure',
        at: a.createdAt,
        summary: `${a.action} (${a.targetType})`,
        organizationId: a.organizationId,
      })),
    ];
    events.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return events.slice(0, limit);
  }
}
