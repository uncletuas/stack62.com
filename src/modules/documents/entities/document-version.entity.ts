import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'document_versions' })
@Index(['documentId', 'version'])
export class DocumentVersionEntity extends AppBaseEntity {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'varchar', length: 220 })
  title!: string;

  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary!: string | null;
}
