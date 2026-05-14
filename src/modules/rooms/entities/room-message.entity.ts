import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type RoomMessageAuthorKind = 'user' | 'coworker' | 'system';

/**
 * A single message in a Room. Slack-compatible enough that we can later
 * sync to Slack via the bridge (next batch). `parentMessageId` enables
 * threads; we keep it nullable until threading lands in the UI.
 */
@Entity({ name: 'room_messages' })
@Index(['roomId', 'createdAt'])
@Index(['parentMessageId'])
export class RoomMessageEntity extends AppBaseEntity {
  @Column({ name: 'room_id', type: 'uuid' })
  roomId!: string;

  @Column({ name: 'author_kind', type: 'varchar', length: 20 })
  authorKind!: RoomMessageAuthorKind;

  /** Set for `user` authors; null for `coworker` / `system`. */
  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId!: string | null;

  /** Markdown body. We don't render server-side; UI handles markdown. */
  @Column({ type: 'text' })
  body!: string;

  /** Top-level message id for thread replies. */
  @Column({ name: 'parent_message_id', type: 'uuid', nullable: true })
  parentMessageId!: string | null;

  /**
   * When the body references files / records / Coworker actions, those
   * land here so the UI can render attachment chips.
   */
  @Column({ type: 'jsonb', nullable: true })
  attachments!: Array<{
    kind: 'file' | 'record' | 'tool_call' | 'plan';
    id: string;
    label?: string;
    extra?: Record<string, unknown>;
  }> | null;

  /** User IDs mentioned via @display-name. */
  @Column({ name: 'mentions', type: 'jsonb', nullable: true })
  mentions!: string[] | null;

  /** Coworker output streamed in chunks lives here for replay. */
  @Column({ name: 'stream_token', type: 'varchar', length: 64, nullable: true })
  streamToken!: string | null;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ default: false })
  deleted!: boolean;
}
