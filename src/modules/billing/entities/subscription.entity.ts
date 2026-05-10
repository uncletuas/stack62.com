import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'paused';

export type SubscriptionInterval = 'monthly' | 'yearly';

/**
 * One row per organization. The org's current plan, billing interval, and
 * Stripe state. Created automatically when an org is created (defaulting
 * to the free plan). Updated by the Stripe webhook handler when the
 * customer upgrades/downgrades/cancels.
 */
@Entity({ name: 'subscriptions' })
@Index(['organizationId'], { unique: true })
export class SubscriptionEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ length: 40, default: 'active' })
  status!: SubscriptionStatus;

  @Column({ length: 10, default: 'monthly' })
  interval!: SubscriptionInterval;

  /** How many seats the org is paying for (per-seat plans only). */
  @Column({ type: 'int', default: 1 })
  seats!: number;

  /** Current billing period; reset when Stripe sends invoice.paid. */
  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd!: boolean;

  /**
   * Stripe IDs — null on the free plan. Explicit `type: 'varchar'` is
   * required: TypeORM cannot infer the column type from `string | null`
   * design-time reflection alone.
   */
  @Column({
    name: 'stripe_customer_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  stripeCustomerId!: string | null;

  @Column({
    name: 'stripe_subscription_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  stripeSubscriptionId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
