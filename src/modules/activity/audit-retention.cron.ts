import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * Audit log retention cron. Walks the org / plan matrix and deletes
 * activity_logs older than each org's plan-defined retention. Free
 * tier = 7 days, Starter = 30, Pro = 90, Business = 365, Enterprise
 * = unlimited.
 *
 * Runs once a day at 03:00 UTC (a quiet window). Configurable via
 * AUDIT_RETENTION_CRON env when you need it to fire elsewhere.
 *
 * The query joins each org to its current subscription's plan and
 * computes the cutoff inline, so adding a new plan tier doesn't
 * require a code change here.
 */
@Injectable()
export class AuditRetentionCron {
  private readonly logger = new Logger(AuditRetentionCron.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Cron(process.env.AUDIT_RETENTION_CRON || CronExpression.EVERY_DAY_AT_3AM)
  async sweep() {
    if (this.config.get<string>('AUDIT_RETENTION_DISABLED') === 'true') {
      return;
    }
    try {
      const result = (await this.dataSource.query(`
        WITH org_retention AS (
          SELECT
            o.id AS org_id,
            COALESCE(p.audit_retention_days, 7) AS retention_days
          FROM organizations o
          LEFT JOIN subscriptions s ON s.organization_id = o.id
          LEFT JOIN plans p ON p.id = s.plan_id
        )
        DELETE FROM activity_logs a
        USING org_retention r
        WHERE a.organization_id = r.org_id
          AND r.retention_days > 0
          AND a.created_at < NOW() - (r.retention_days || ' days')::interval
        RETURNING a.id
      `)) as Array<{ id: string }> | [Array<{ id: string }>, number];

      const removed = Array.isArray(result)
        ? Array.isArray(result[0])
          ? (result[1] as number)
          : (result as Array<{ id: string }>).length
        : 0;

      if (removed > 0) {
        this.logger.log(`Audit sweep deleted ${removed} rows.`);
      } else {
        this.logger.debug('Audit sweep: nothing to delete.');
      }
    } catch (err) {
      this.logger.error(
        `Audit sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
