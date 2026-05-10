import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'field_definitions' })
@Index(['entityDefinitionId', 'key'], { unique: true })
export class FieldDefinitionEntity extends AppBaseEntity {
  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ name: 'system_version_id', type: 'uuid' })
  systemVersionId!: string;

  @Column({ name: 'entity_definition_id', type: 'uuid' })
  entityDefinitionId!: string;

  @Column({ length: 180 })
  name!: string;

  @Column({ length: 180 })
  key!: string;

  @Column({ name: 'data_type', length: 80 })
  dataType!: string;

  @Column({ default: false })
  required!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;
}
