import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A scoped public token that lets an organization embed the Stack62 assistant
 * on their own website. The token authenticates the public widget chat
 * endpoint. It is intentionally narrow: the widget answers from an org-curated
 * knowledge base (and, optionally, indexed documents) — it has NO access to
 * CRM records or write actions.
 *
 * The raw token is shown once at creation and only its SHA-256 hash is stored.
 */
@Entity({ name: 'widget_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['organizationId'])
export class WidgetTokenEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ type: 'varchar', length: 120 })
  label!: string;

  /** SHA-256 of the raw token. */
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  /** First chars of the raw token, for display in the dashboard (e.g. s62w_ab12). */
  @Column({ name: 'token_prefix', type: 'varchar', length: 16 })
  tokenPrefix!: string;

  /** Origins allowed to call the widget (CORS). Empty = allow any (dev only). */
  @Column({ name: 'allowed_origins', type: 'jsonb', default: () => "'[]'" })
  allowedOrigins!: string[];

  /** Curated, public-safe knowledge the assistant answers from. */
  @Column({ name: 'knowledge_base', type: 'text', nullable: true })
  knowledgeBase!: string | null;

  /** Also ground answers in the org's indexed documents (off by default). */
  @Column({ name: 'use_document_search', type: 'boolean', default: false })
  useDocumentSearch!: boolean;

  /** First-message greeting shown by the widget. */
  @Column({ type: 'text', nullable: true })
  greeting!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;
}
