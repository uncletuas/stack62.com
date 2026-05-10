import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'workflow_definitions' })
@Index(['systemId', 'key'], { unique: true })
export class WorkflowDefinitionEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'system_version_id', type: 'uuid', nullable: true })
  systemVersionId!: string | null;

  @Column({ name: 'module_definition_id', type: 'uuid', nullable: true })
  moduleDefinitionId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 180 })
  key!: string;

  @Column({ name: 'trigger_type', length: 100 })
  triggerType!: string;

  @Column({ type: 'jsonb' })
  definition!: Record<string, unknown>;

  @Column({ length: 40, default: 'draft' })
  status!: string;
}
