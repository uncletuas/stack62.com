import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type JobRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobRunStep {
  type: 'tool_call' | 'tool_result' | 'message' | 'note';
  name?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  text?: string;
  ok?: boolean;
  ts: string;
}

@Entity({ name: 'coworker_job_runs' })
@Index(['jobId'])
export class JobRunEntity extends AppBaseEntity {
  @Column({ name: 'job_id', type: 'uuid' })
  jobId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ length: 30, default: 'running' })
  status!: JobRunStatus;

  @Column({ name: 'triggered_by', length: 30, default: 'manual' })
  triggeredBy!: 'manual' | 'schedule' | 'event';

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  steps!: JobRunStep[];

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
