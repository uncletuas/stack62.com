import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'schedules' })
@Index(['organizationId', 'workspaceId', 'systemId'])
export class ScheduleEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ length: 180 })
  title!: string;

  @Column({ length: 80 })
  kind!: string;

  @Column({ length: 30, default: 'scheduled' })
  status!: string;

  @Column({ name: 'starts_at', type: 'timestamp' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt!: Date | null;

  @Column({ name: 'recurrence_rule', type: 'text', nullable: true })
  recurrenceRule!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  /**
   * Per-user single-Coworker model: when this schedule fires and the
   * Coworker has autonomousMode on, the Coworker executes the
   * associated job/task on the user's behalf. When `assignedToCoworker`
   * is false, the schedule reminds the human instead.
   */
  @Column({ name: 'assigned_to_coworker', default: false })
  assignedToCoworker!: boolean;
}
