import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'closed';

/**
 * A security incident raised in (or escalated to) the Security Center —
 * suspicious access, credential-stuffing bursts, abuse, etc. Most are
 * created by detection jobs; staff can also open them manually.
 */
@Entity({ name: 'admin_security_incidents' })
@Index(['status', 'severity'])
export class SecurityIncidentEntity extends AppBaseEntity {
  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ length: 20, default: 'medium' })
  severity!: IncidentSeverity;

  @Column({ length: 20, default: 'open' })
  status!: IncidentStatus;

  /** What triggered it, e.g. 'failed_login_burst', 'api_abuse'. */
  @Column({ length: 80, default: 'manual' })
  source!: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'subject_user_id', type: 'uuid', nullable: true })
  subjectUserId!: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}
