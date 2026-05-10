import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type ActivityOrigin = 'user' | 'ai' | 'system';

@Entity({ name: 'activity_logs' })
@Index(['organizationId', 'workspaceId', 'systemId'])
export class ActivityLogEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ length: 120 })
  action!: string;

  @Column({ name: 'target_type', length: 120 })
  targetType!: string;

  @Column({ name: 'target_id', length: 120 })
  targetId!: string;

  @Column({ type: 'varchar', length: 20, default: 'user' })
  origin!: ActivityOrigin;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
