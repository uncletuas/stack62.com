import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'document_comments' })
@Index(['documentId', 'status'])
export class DocumentCommentEntity extends AppBaseEntity {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId!: string | null;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  anchor!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 30, default: 'open' })
  status!: string;
}
