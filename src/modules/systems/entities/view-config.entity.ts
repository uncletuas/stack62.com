import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'view_configs' })
export class ViewConfigEntity extends AppBaseEntity {
  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'system_version_id', type: 'uuid' })
  systemVersionId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 80 })
  type!: string;

  @Column({ name: 'entity_definition_id', type: 'uuid', nullable: true })
  entityDefinitionId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;
}
