import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type SupportTicketStatus =
  | 'open'
  | 'pending'
  | 'on_hold'
  | 'resolved'
  | 'closed';

export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * A customer support ticket tracked from the Assembly Support Center.
 * Lightweight by design — the goal is operational visibility (SLA, CSAT,
 * escalation), not a full helpdesk.
 */
@Entity({ name: 'support_tickets' })
@Index(['status', 'priority'])
export class SupportTicketEntity extends AppBaseEntity {
  @Column({ length: 200 })
  subject!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ length: 30, default: 'open' })
  status!: SupportTicketStatus;

  @Column({ length: 20, default: 'normal' })
  priority!: SupportTicketPriority;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'requester_user_id', type: 'uuid', nullable: true })
  requesterUserId!: string | null;

  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId!: string | null;

  /** Minutes-to-first-response target; drives the SLA badge in the UI. */
  @Column({ name: 'sla_minutes', type: 'int', default: 480 })
  slaMinutes!: number;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  /** 1–5 customer-satisfaction score, set when the ticket is closed. */
  @Column({ name: 'csat_score', type: 'int', nullable: true })
  csatScore!: number | null;
}
