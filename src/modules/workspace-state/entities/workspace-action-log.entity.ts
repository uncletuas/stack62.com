import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';
import type {
  WorkspaceActionPayload,
  WorkspaceActionVerb,
} from '../../../shared/workspace-actions';

/**
 * Immutable audit log — one row per applied workspace action.
 *
 * This is what "Restore version" reads from. Every mutation, whether
 * from a human typing in TipTap or a Coworker dispatching a
 * structured action, leaves a row here. Replaying actions from any
 * point reconstructs the document at that point (in theory; in
 * practice we restore via the Yjs snapshot then re-apply actions
 * after the snapshot timestamp).
 *
 * Indexed by doc + occurredAt so the history view paginates fast.
 */
@Entity({ name: 'workspace_action_log' })
@Index(['docId', 'occurredAt'])
export class WorkspaceActionLogEntity extends AppBaseEntity {
  @Column({ name: 'doc_id', type: 'uuid' })
  docId!: string;

  /** 'user' for a human, 'coworker' for the AI. */
  @Column({ name: 'actor_kind', type: 'varchar', length: 20 })
  actorKind!: 'user' | 'coworker';

  /** The human in the loop, always. Coworker actions attribute to a
   *  human owner so we never have ghost edits with no responsibility. */
  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  /** Which Coworker (when actorKind = coworker). */
  @Column({ name: 'coworker_id', type: 'uuid', nullable: true })
  coworkerId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  verb!: WorkspaceActionVerb;

  @Column({ type: 'jsonb' })
  payload!: WorkspaceActionPayload;

  /**
   * Wall-clock at apply time. Distinct from `createdAt` because in
   * future a client can backfill actions (an offline edit replayed
   * after reconnect) — `occurredAt` is when the edit *happened*;
   * `createdAt` is when the row landed.
   */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
