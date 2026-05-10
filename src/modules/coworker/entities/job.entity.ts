import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type JobStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type JobTriggerType = 'manual' | 'schedule' | 'event';

export interface JobTriggerConfig {
  /** ISO-8601 — used for one-shot schedules. */
  runAt?: string | null;
  /** RFC5545 RRULE — used for recurring schedules. */
  rrule?: string | null;
  /** Event name — used for event-driven jobs (future). */
  eventName?: string | null;
}

@Entity({ name: 'coworker_jobs' })
@Index(['organizationId', 'workspaceId'])
@Index(['nextRunAt'])
export class JobEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text' })
  instructions!: string;

  @Column({ length: 30, default: 'pending' })
  status!: JobStatus;

  @Column({ name: 'trigger_type', length: 30, default: 'manual' })
  triggerType!: JobTriggerType;

  @Column({ name: 'trigger_config', type: 'jsonb', nullable: true })
  triggerConfig!: JobTriggerConfig | null;

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  nextRunAt!: Date | null;

  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true })
  lastRunAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'autopilot', default: true })
  autopilot!: boolean;

  @Column({ name: 'run_count', type: 'int', default: 0 })
  runCount!: number;

  @Column({ name: 'paused_at', type: 'timestamp', nullable: true })
  pausedAt!: Date | null;
}
