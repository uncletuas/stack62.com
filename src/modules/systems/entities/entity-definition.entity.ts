import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'entity_definitions' })
@Index(['systemVersionId', 'key'], { unique: true })
export class EntityDefinitionEntity extends AppBaseEntity {
  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'system_version_id', type: 'uuid' })
  systemVersionId!: string;

  @Column({ name: 'module_definition_id', type: 'uuid' })
  moduleDefinitionId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 180 })
  key!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;
}
