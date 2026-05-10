import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'share_packages' })
@Index(['organizationId', 'workspaceId', 'systemId', 'token'], { unique: true })
export class SharePackageEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 80 })
  mode!: string;

  @Column({ name: 'data_access_mode', length: 80 })
  dataAccessMode!: string;

  @Column({ length: 100, unique: true })
  token!: string;

  @Column({ length: 40, default: 'active' })
  status!: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;
}
