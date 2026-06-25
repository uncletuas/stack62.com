import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type OpsRequestType =
  | 'run_migrations'
  | 'reseed_plans'
  | 'rotate_secret'
  | 'custom_trigger';

export type OpsRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed';

/**
 * A risky engineering action that follows request → approve → execute, mirroring
 * the product's Plan→Diff→Approve trust moat. The requester can never approve
 * their own request; high-risk types require a super_admin approver. The full
 * lifecycle (who requested, who approved, the result/error) is captured here AND
 * in the audit log, so nothing dangerous happens without a second pair of eyes.
 */
@Entity({ name: 'ops_requests' })
@Index(['status'])
export class OpsRequestEntity extends AppBaseEntity {
  @Column({ length: 40 })
  type!: OpsRequestType;

  @Column({ length: 40, default: 'pending' })
  status!: OpsRequestStatus;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'requested_by_staff_id', type: 'uuid' })
  requestedByStaffId!: string;

  @Column({ name: 'decided_by_staff_id', type: 'uuid', nullable: true })
  decidedByStaffId!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result!: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
