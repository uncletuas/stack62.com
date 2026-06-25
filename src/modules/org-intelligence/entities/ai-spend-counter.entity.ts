import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * Per-org, per-month frontier spend ledger. One row accumulates the estimated
 * USD spent on paid models plus token totals for a billing window (YYYY-MM).
 * The budget governor reads this to enforce AI_MONTHLY_BUDGET_USD and trigger
 * the downgrade ladder (frontier → cheap → local) as an org nears its cap.
 *
 * Cost is stored in micro-dollars (USD × 1e6) as a bigint string to avoid
 * floating-point drift across many small increments.
 */
@Entity({ name: 'ai_spend_counters' })
@Index(['organizationId', 'period'], { unique: true })
export class AiSpendCounterEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** YYYY-MM billing window. */
  @Column({ length: 16 })
  period!: string;

  @Column({ name: 'cost_micros', type: 'bigint', default: 0 })
  costMicros!: string;

  @Column({ name: 'input_tokens', type: 'bigint', default: 0 })
  inputTokens!: string;

  @Column({ name: 'output_tokens', type: 'bigint', default: 0 })
  outputTokens!: string;

  @Column({ name: 'call_count', type: 'int', default: 0 })
  callCount!: number;
}
