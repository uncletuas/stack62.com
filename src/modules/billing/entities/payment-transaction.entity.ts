import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type PaymentStatus = 'success' | 'failed' | 'pending' | 'refunded';

/**
 * A persisted record of money actually moving — written from the Paystack
 * webhook (charge.success / refund). This is what makes real collected revenue
 * (vs. estimated MRR) queryable for the analytics dashboard. Amounts are in the
 * provider's minor unit (kobo for NGN, cents for USD), matching how Paystack
 * reports them.
 */
@Entity({ name: 'payment_transactions' })
@Index(['status'])
@Index(['createdAt'])
export class PaymentTransactionEntity extends AppBaseEntity {
  @Column({ length: 40, default: 'paystack' })
  provider!: string;

  /** Provider transaction reference. Unique so the webhook is idempotent. */
  @Index({ unique: true })
  @Column({ length: 160 })
  reference!: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** Amount in the provider's minor unit (kobo / cents). */
  @Column({ type: 'bigint', default: 0 })
  amount!: number;

  @Column({ length: 8, default: 'NGN' })
  currency!: string;

  @Column({ length: 20, default: 'pending' })
  status!: PaymentStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  channel!: string | null;

  @Column({ name: 'customer_email', type: 'varchar', length: 255, nullable: true })
  customerEmail!: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'raw_event', type: 'jsonb', nullable: true })
  rawEvent!: Record<string, unknown> | null;
}
