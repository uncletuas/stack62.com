import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * An email conversation — one per (connection, thread). Mirrors the WhatsApp
 * conversation model so the coworker (and the operator) see a real thread per
 * counterparty instead of a flat stream of messages. Works for both Gmail
 * (OAuth) and SMTP/IMAP connections; `providerKey` records which.
 */
@Entity({ name: 'email_conversations' })
@Index(['connectionId', 'threadKey'], { unique: true })
@Index(['organizationId', 'workspaceId'])
export class EmailConversationEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /** 'google-workspace' | 'smtp-email' */
  @Column({ name: 'provider_key', length: 40 })
  providerKey!: string;

  /**
   * Stable grouping key, always set: the Gmail threadId when available,
   * otherwise the counterparty email. Backs the unique constraint.
   */
  @Column({ name: 'thread_key', length: 255 })
  threadKey!: string;

  /** Provider thread id (Gmail threadId), for reference. */
  @Column({ name: 'thread_id', type: 'varchar', length: 255, nullable: true })
  threadId!: string | null;

  @Column({ name: 'counterparty_email', length: 255 })
  counterpartyEmail!: string;

  @Column({
    name: 'counterparty_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  counterpartyName!: string | null;

  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: 'last_message_preview', type: 'text', nullable: true })
  lastMessagePreview!: string | null;

  /** 'inbound' | 'outbound' — direction of the most recent message. */
  @Column({
    name: 'last_direction',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  lastDirection!: string | null;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount!: number;

  /**
   * Per-thread override for the auto-responder. null = follow the workspace
   * default; true/false = force on/off for this thread.
   */
  @Column({ name: 'auto_reply_override', type: 'boolean', nullable: true })
  autoReplyOverride!: boolean | null;

  /** 'open' | 'archived' */
  @Column({ length: 12, default: 'open' })
  status!: string;
}
