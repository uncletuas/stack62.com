import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'record_fields' })
@Index(['collectionId', 'key'])
export class RecordFieldEntity extends AppBaseEntity {
  @Column({ name: 'collection_id', type: 'uuid' })
  collectionId!: string;

  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'varchar', length: 180 })
  key!: string;

  @Column({ name: 'data_type', type: 'varchar', length: 40, default: 'text' })
  dataType!: string;

  @Column({ type: 'boolean', default: false })
  required!: boolean;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'jsonb', nullable: true })
  config!: Record<string, unknown> | null;
}
