import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * One row per text chunk extracted from a file. Used by the semantic
 * search Coworker tool: query → embed → cosine search → top-K rows →
 * snippet returned with citations.
 *
 * `embedding` is stored as JSON for portability (TypeORM doesn't have
 * a first-class `vector` column type yet). We do cosine similarity with
 * raw SQL using pgvector's `<=>` operator on a generated column added
 * by a migration. See semantic-search.service for the bootstrap that
 * runs `CREATE EXTENSION vector` on first start.
 *
 * Embedding dimensionality is 1536 (OpenAI text-embedding-3-small) or
 * configurable via EMBEDDING_DIMENSIONS env.
 */
@Entity({ name: 'document_chunks' })
@Index(['organizationId', 'fileId'])
@Index(['fileId'])
export class DocumentChunkEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'folder_id', type: 'uuid', nullable: true })
  folderId!: string | null;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  /** 0-indexed position of this chunk inside the source document. */
  @Column({ type: 'int' })
  ordinal!: number;

  /** The original text. ~500 tokens worth. */
  @Column({ type: 'text' })
  text!: string;

  /**
   * The embedding vector. Stored as a JSON array; the actual pgvector
   * column is created by the bootstrap SQL in semantic-search.service.
   */
  @Column({ type: 'jsonb' })
  embedding!: number[];

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
