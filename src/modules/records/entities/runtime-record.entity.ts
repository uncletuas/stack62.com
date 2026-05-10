import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'runtime_records' })
@Index(['organizationId', 'workspaceId', 'systemId', 'entityDefinitionId'])
export class RuntimeRecordEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'module_definition_id', type: 'uuid' })
  moduleDefinitionId!: string;

  @Column({ name: 'entity_definition_id', type: 'uuid' })
  entityDefinitionId!: string;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @Column({ length: 40, default: 'active' })
  status!: string;

  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
