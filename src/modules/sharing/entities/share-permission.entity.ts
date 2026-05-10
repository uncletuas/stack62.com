import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type SharePermissionMode = 'view' | 'use' | 'edit';

@Entity({ name: 'share_permissions' })
@Index(['organizationId', 'workspaceId', 'targetType', 'targetId'])
export class SharePermissionEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'target_type', type: 'varchar', length: 80 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ name: 'subject_type', type: 'varchar', length: 40 })
  subjectType!: 'user' | 'team' | 'department' | 'role' | 'public_link';

  @Column({ name: 'subject_id', type: 'varchar', length: 160, nullable: true })
  subjectId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  mode!: SharePermissionMode;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: string;
}
