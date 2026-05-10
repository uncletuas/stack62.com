import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'ai_request_logs' })
@Index(['organizationId', 'workspaceId', 'taskType'])
export class AiRequestLogEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ name: 'provider', type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'model', type: 'varchar', length: 160 })
  model!: string;

  @Column({ name: 'task_type', type: 'varchar', length: 80 })
  taskType!: string;

  @Column({ type: 'varchar', length: 30, default: 'succeeded' })
  status!: 'succeeded' | 'failed';

  @Column({ name: 'prompt_preview', type: 'text', nullable: true })
  promptPreview!: string | null;

  @Column({ name: 'response_preview', type: 'text', nullable: true })
  responsePreview!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
