import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';
import type { WorkspaceDocKind } from '../../../shared/workspace-actions';

/**
 * The persistent home of an AI-native workspace document, sheet, or
 * presentation. The "live" representation is a Y.Doc held in memory
 * (and by connected clients); the bytes on disk are the encoded
 * snapshot.
 *
 * We snapshot — not the action log — as the canonical state because
 * (a) Yjs snapshots are smaller than replaying every action and
 * (b) the action log is for audit and explanation, not for crash
 * recovery. The snapshot is updated by `WorkspaceActionService` after
 * every successful apply (debounced when Hocuspocus is wired up).
 *
 * `kind` controls the in-memory schema of the Y.Doc:
 *   - document → Y.XmlFragment "content" (TipTap)
 *   - sheet    → Y.Array "sheets" + Y.Map "cells"
 *   - slides   → Y.Array "slides" + Y.Map "elements"
 */
@Entity({ name: 'workspace_docs' })
@Index(['organizationId', 'workspaceId'])
@Index(['organizationId', 'kind'])
export class WorkspaceDocEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'varchar', length: 30 })
  kind!: WorkspaceDocKind;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /**
   * Encoded Yjs state snapshot. We store as bytea; never read as
   * JSON. Empty Buffer = the Y.Doc has been created but has no
   * content yet (a brand-new doc the first action hasn't landed on).
   */
  @Column({ type: 'bytea' })
  yjsState!: Buffer;

  /**
   * Monotonically increasing — incremented on every applied action.
   * Used by clients to detect they're up to date without diffing
   * the binary snapshot.
   */
  @Column({ name: 'current_version', type: 'int', default: 0 })
  currentVersion!: number;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: string; // 'active' | 'deleted'

  /**
   * Free-form metadata bag — used today for cross-links to the
   * `files` table (when this doc was imported from a .docx upload)
   * and to AI-built systems (when a sheet is bound to records). The
   * shape stays open because each kind has its own needs.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
