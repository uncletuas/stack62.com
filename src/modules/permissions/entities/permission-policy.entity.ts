import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'permission_policies' })
@Index(['organizationId', 'workspaceId', 'systemId', 'name'], { unique: true })
export class PermissionPolicyEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 80 })
  scope!: string;

  @Column({ length: 120 })
  role!: string;

  @Column({ name: 'resource_type', length: 120 })
  resourceType!: string;

  @Column({ type: 'jsonb' })
  actions!: string[];

  @Column({ name: 'field_restrictions', type: 'jsonb', nullable: true })
  fieldRestrictions!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  conditions!: Record<string, unknown> | null;

  @Column({ length: 40, default: 'active' })
  status!: string;
}
