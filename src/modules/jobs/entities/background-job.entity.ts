import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'background_jobs' })
@Index(['queueName', 'status'])
export class BackgroundJobEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'queue_name', length: 120 })
  queueName!: string;

  @Column({ name: 'job_type', length: 120 })
  jobType!: string;

  @Column({ name: 'bull_job_id', type: 'varchar', length: 120, nullable: true })
  bullJobId!: string | null;

  @Column({ length: 40, default: 'queued' })
  status!: string;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ type: 'jsonb', nullable: true })
  input!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  output!: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;
}
