import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * One cached resolution of a user prompt, scoped to an organization (and
 * optionally a workspace). The response-cache lets the engine replay a prior
 * *local* resolution — a static reply, or a read-only tool call re-executed
 * live — instead of escalating to a paid frontier model. This is the single
 * biggest API-cost saver in the intelligence router.
 *
 * Safety: we only ever cache things that are safe to replay —
 *   - `kind = 'reply'`  → a static, workspace-independent answer.
 *   - `kind = 'tool'`   → a *read-like* tool call (actionLevel ≤ 1). On a hit
 *                         the tool is dispatched again so the data is fresh;
 *                         mutating/sending tools are never cached.
 *
 * Matching is two-tier: an exact normalized-hash lookup first, then a cosine
 * search over the org's embeddings (local model) above a high threshold.
 */
@Entity({ name: 'ai_response_cache' })
@Index(['organizationId', 'workspaceId'])
@Index(['organizationId', 'promptHash'])
export class AiResponseCacheEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  /** Normalized prompt hash — exact-match fast path before the vector search. */
  @Column({ name: 'prompt_hash', type: 'varchar', length: 64 })
  promptHash!: string;

  /** The original (normalized) prompt text — for debugging and exact compare. */
  @Column({ name: 'prompt_text', type: 'text' })
  promptText!: string;

  /** Local embedding of the prompt, stored as JSONB (cosine in JS / pgvector). */
  @Column({ type: 'jsonb' })
  embedding!: number[];

  @Column({ type: 'varchar', length: 16 })
  kind!: 'reply' | 'tool';

  /** kind='reply' → the static text to return. */
  @Column({ type: 'text', nullable: true })
  reply!: string | null;

  /** kind='tool' → the read-like tool to re-dispatch live. */
  @Column({ name: 'tool_name', type: 'varchar', length: 120, nullable: true })
  toolName!: string | null;

  @Column({ name: 'tool_input', type: 'jsonb', nullable: true })
  toolInput!: Record<string, unknown> | null;

  @Column({ name: 'hit_count', type: 'int', default: 0 })
  hitCount!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
