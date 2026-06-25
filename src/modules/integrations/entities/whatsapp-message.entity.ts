import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A single message in a WhatsApp conversation, inbound or outbound. Outbound
 * rows are written both for human-sent and coworker-sent (auto-reply) messages
 * so the thread reads as one continuous chat.
 */
@Entity({ name: 'whatsapp_messages' })
@Index(['conversationId', 'createdAt'])
export class WhatsAppMessageEntity extends AppBaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /** 'inbound' | 'outbound' */
  @Column({ length: 10 })
  direction!: string;

  @Column({ type: 'text', default: '' })
  text!: string;

  /** Provider message id (Baileys key.id or Cloud API message id). */
  @Column({
    name: 'wa_message_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  waMessageId!: string | null;

  /** 'contact' | 'coworker' | 'user' — who authored an outbound message. */
  @Column({ name: 'authored_by', length: 12, default: 'contact' })
  authoredBy!: string;

  /** received | sent | auto_replied | failed */
  @Column({ length: 16, default: 'received' })
  status!: string;

  /**
   * Media kind when this message carries an attachment: 'image' | 'video' |
   * 'audio' | 'document' | 'sticker'. Null for plain text messages.
   */
  @Column({ name: 'media_type', type: 'varchar', length: 16, nullable: true })
  mediaType!: string | null;

  /** Stored file id (FilesService) holding the downloaded/uploaded media bytes. */
  @Column({ name: 'media_file_id', type: 'uuid', nullable: true })
  mediaFileId!: string | null;

  /** MIME type of the media, e.g. image/jpeg, application/pdf. */
  @Column({
    name: 'media_mime_type',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  mediaMimeType!: string | null;

  /** Original/derived filename for the media, shown in the thread. */
  @Column({
    name: 'media_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  mediaFilename!: string | null;

  /** This message replied to another — its id and a short preview for the UI. */
  @Column({ name: 'reply_to_message_id', type: 'uuid', nullable: true })
  replyToMessageId!: string | null;

  @Column({ name: 'reply_to_preview', type: 'text', nullable: true })
  replyToPreview!: string | null;

  /**
   * Emoji reactions on this message, keyed by who reacted. `me` is our
   * account (sent from Stack62 or the linked phone); `them` is the contact.
   * Empty string clears a reaction.
   */
  @Column({ type: 'jsonb', nullable: true })
  reactions!: { me?: string; them?: string } | null;

  /** True when the message was deleted for everyone (rendered as a tombstone). */
  @Column({ type: 'boolean', default: false })
  deleted!: boolean;
}
