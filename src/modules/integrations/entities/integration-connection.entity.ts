import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'integration_connections' })
@Index(['organizationId', 'providerKey'])
export class IntegrationConnectionEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'provider_key', length: 80 })
  providerKey!: string;

  @Column({ length: 160 })
  name!: string;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  credentials!: Record<string, unknown> | null;

  @Column({ length: 40, default: 'active' })
  status!: string;

  @Column({ name: 'last_checked_at', type: 'timestamp', nullable: true })
  lastCheckedAt!: Date | null;
}
