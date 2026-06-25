import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A single email in a conversation, inbound or outbound. Outbound rows cover
 * both human-sent and coworker-sent (draft/auto-reply) messages so the thread
 * reads as one continuous exchange. `status='draft'` is a coworker-proposed
 * reply awaiting the user's approval.
 */
@Entity({ name: 'email_messages' })
@Index(['conversationId', 'createdAt'])
@Index(['connectionId', 'externalId'], { unique: true })
export class EmailMessageEntity extends AppBaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  /** 'inbound' | 'outbound' */
  @Column({ length: 10 })
  direction!: string;

  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  @Column({ name: 'body_text', type: 'text', default: '' })
  bodyText!: string;

  @Column({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml!: string | null;

  /**
   * Provider message id (Gmail message id / IMAP uid / RFC2822 Message-ID).
   * Unique per connection — dedupes the poller. Drafts get a synthetic id.
   */
  @Column({ name: 'external_id', length: 255 })
  externalId!: string;

  /** 'contact' | 'coworker' | 'user' */
  @Column({ name: 'authored_by', length: 12, default: 'contact' })
  authoredBy!: string;

  /** received | sent | auto_replied | draft | failed */
  @Column({ length: 16, default: 'received' })
  status!: string;

  @Column({ name: 'received_at', type: 'timestamp', nullable: true })
  receivedAt!: Date | null;
}
