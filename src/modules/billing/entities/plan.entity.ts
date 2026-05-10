import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type PlanTier =
  | 'free'
  | 'starter'
  | 'pro'
  | 'business'
  | 'enterprise';

/**
 * Pricing plan catalog. Seeded at startup; not directly editable by users.
 *
 * Limits encoded here are the **soft limits** the API will check before
 * letting an org consume more API credits / storage / members. Stripe
 * price IDs are populated by the operator after the prices are created
 * in the Stripe dashboard.
 */
@Entity({ name: 'plans' })
export class PlanEntity extends AppBaseEntity {
  @Column({ length: 40, unique: true })
  tier!: PlanTier;

  @Column({ length: 80 })
  name!: string;

  @Column({ type: 'text' })
  tagline!: string;

  @Column({ name: 'monthly_price_cents', type: 'int', default: 0 })
  monthlyPriceCents!: number;

  @Column({ name: 'yearly_price_cents', type: 'int', default: 0 })
  yearlyPriceCents!: number;

  @Column({ length: 8, default: 'USD' })
  currency!: string;

  /** Per-seat? false = flat-rate (Free / Enterprise). */
  @Column({ name: 'per_seat', default: true })
  perSeat!: boolean;

  /** -1 = unlimited. */
  @Column({ name: 'max_members', type: 'int', default: 1 })
  maxMembers!: number;

  /** AI requests / month. -1 = unlimited. 0 = trial-style 1-of-each. */
  @Column({ name: 'monthly_ai_requests', type: 'int', default: 0 })
  monthlyAiRequests!: number;

  /** Active systems cap. -1 = unlimited. */
  @Column({ name: 'max_active_systems', type: 'int', default: 1 })
  maxActiveSystems!: number;

  @Column({ name: 'storage_gb', type: 'int', default: 1 })
  storageGb!: number;

  /** Workflows cap. -1 = unlimited. */
  @Column({ name: 'max_workflows', type: 'int', default: 1 })
  maxWorkflows!: number;

  @Column({ name: 'audit_retention_days', type: 'int', default: 7 })
  auditRetentionDays!: number;

  @Column({ name: 'allow_premium_integrations', default: false })
  allowPremiumIntegrations!: boolean;

  @Column({ name: 'allow_sso', default: false })
  allowSso!: boolean;

  @Column({ name: 'support_level', length: 40, default: 'community' })
  supportLevel!: string;

  /**
   * Stripe IDs. Operator fills after creating prices in Stripe.
   * Explicit `type: 'varchar'` is required because TypeORM cannot infer
   * the column type from a `string | null` reflection alone.
   */
  @Column({
    name: 'stripe_monthly_price_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  stripeMonthlyPriceId!: string | null;

  @Column({
    name: 'stripe_yearly_price_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  stripeYearlyPriceId!: string | null;

  @Column({ name: 'is_published', default: true })
  isPublished!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  /** Free-form bullet list rendered on the pricing page. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  features!: string[];
}
