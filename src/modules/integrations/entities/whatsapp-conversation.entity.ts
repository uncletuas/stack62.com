import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A WhatsApp conversation — one per (connection, contact). This is how the
 * system "identifies a WhatsApp chat": inbound and outbound messages are
 * grouped here so the coworker (and the operator) can see a real thread per
 * contact instead of a flat stream of webhook events.
 *
 * Works for both channels: `whatsapp-web` (linked device) and `whatsapp-cloud`
 * (official API). `channel` records which one this thread belongs to so replies
 * go back out the same way they came in.
 */
@Entity({ name: 'whatsapp_conversations' })
@Index(['connectionId', 'contactPhone'], { unique: true })
@Index(['organizationId', 'workspaceId'])
export class WhatsAppConversationEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /** 'web' (linked device) | 'cloud' (official API). */
  @Column({ length: 12 })
  channel!: string;

  /** Contact phone number, digits only (country code, no '+'). */
  @Column({ name: 'contact_phone', length: 32 })
  contactPhone!: string;

  /** Full WhatsApp JID where known (web channel), e.g. "234...@s.whatsapp.net". */
  @Column({ name: 'contact_jid', type: 'varchar', length: 80, nullable: true })
  contactJid!: string | null;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  contactName!: string | null;

  /**
   * Contact's WhatsApp profile picture URL, when the linked device can see it.
   * These are WhatsApp CDN URLs (pps.whatsapp.net) that can expire, so we
   * refresh them whenever a new inbound message arrives.
   */
  @Column({ name: 'contact_avatar_url', type: 'text', nullable: true })
  contactAvatarUrl!: string | null;

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
   * Per-chat override for the auto-responder. null = follow the workspace
   * default; true/false = force on/off for this contact (e.g. pause the bot
   * for a customer a human took over).
   */
  @Column({ name: 'auto_reply_override', type: 'boolean', nullable: true })
  autoReplyOverride!: boolean | null;

  /** 'open' | 'archived' */
  @Column({ length: 12, default: 'open' })
  status!: string;
}
