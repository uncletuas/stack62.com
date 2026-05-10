import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type UsageMetric =
  | 'ai_requests'
  | 'plan_apply'
  | 'document_generate'
  | 'system_deploy'
  | 'workflow_run';

/**
 * Per-org, per-metric, per-period (YYYY-MM string) running totals. A
 * single row stores the cumulative count for one metric in one billing
 * window; reset is implicit by writing a new row when `period` rolls
 * forward.
 *
 * Used by the BillingGuard to gate features on the free plan (1-of-each
 * trial) and on paid plans against their monthly cap.
 */
@Entity({ name: 'usage_counters' })
@Index(['organizationId', 'metric', 'period'], { unique: true })
export class UsageCounterEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ length: 40 })
  metric!: UsageMetric;

  /** YYYY-MM. Lifetime counters use `lifetime`. */
  @Column({ length: 16 })
  period!: string;

  @Column({ type: 'int', default: 0 })
  count!: number;
}
