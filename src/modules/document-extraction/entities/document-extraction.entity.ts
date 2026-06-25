import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type ExtractionStatus =
  | 'pending'
  | 'extracting'
  | 'completed'
  | 'failed';

export type ExtractionDocumentType =
  | 'receipt'
  | 'invoice'
  | 'letter'
  | 'contract'
  | 'id_card'
  | 'business_card'
  | 'form'
  | 'unknown';

/**
 * One row per file we've run vision extraction on. The file's ID is the
 * unique key — re-extracting overwrites this row. We keep the raw text
 * so the embedding pipeline can reuse it without re-OCRing.
 */
@Entity({ name: 'document_extractions' })
@Index(['fileId'], { unique: true })
@Index(['organizationId', 'documentType'])
export class DocumentExtractionEntity extends AppBaseEntity {
  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: ExtractionStatus;

  @Column({
    name: 'document_type',
    type: 'varchar',
    length: 40,
    default: 'unknown',
  })
  documentType!: ExtractionDocumentType;

  /**
   * Structured fields extracted from the document. Shape depends on
   * documentType:
   *   receipt:  { vendor, date, lineItems[], subtotal, tax, total, currency }
   *   invoice:  { vendor, invoiceNumber, date, dueDate, lineItems[], total, currency }
   *   letter:   { sender, recipient, date, subject, summary }
   *   id_card:  { fullName, idNumber, dob, expiresAt }
   *   form:     { fields: { label: value, ... } }
   */
  @Column({ name: 'extracted_fields', type: 'jsonb', nullable: true })
  extractedFields!: Record<string, unknown> | null;

  /** Plain text representation, suitable for embedding + indexing. */
  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText!: string | null;

  /** Model self-reported confidence on the extraction (0..1). */
  @Column({ type: 'float', nullable: true })
  confidence!: number | null;

  @Column({ name: 'model_used', type: 'varchar', length: 80, nullable: true })
  modelUsed!: string | null;

  @Column({ name: 'extracted_at', type: 'timestamptz', nullable: true })
  extractedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
