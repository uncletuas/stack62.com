import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type WorkflowRunStatus = 'active' | 'completed' | 'cancelled' | 'failed';

export interface WorkflowRunHistoryEntry {
  at: string;
  actorUserId: string;
  fromStepKey: string | null;
  toStepKey: string | null;
  action: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Entity({ name: 'workflow_runs' })
@Index(['organizationId', 'workspaceId', 'systemId', 'status'])
@Index(['workflowDefinitionId', 'status'])
export class WorkflowRunEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'workflow_definition_id', type: 'uuid' })
  workflowDefinitionId!: string;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId!: string | null;

  @Column({ name: 'started_by_user_id', type: 'uuid' })
  startedByUserId!: string;

  @Column({
    name: 'current_step_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  currentStepKey!: string | null;

  @Column({ length: 40, default: 'active' })
  status!: WorkflowRunStatus;

  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: '[]' })
  history!: WorkflowRunHistoryEntry[];

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  nextRunAt!: Date | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'max_retries', type: 'int', default: 3 })
  maxRetries!: number;

  @Column({ name: 'escalation_at', type: 'timestamp', nullable: true })
  escalationAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;
}
