import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type AnnouncementChannel = 'in_app' | 'email' | 'sms' | 'push';
export type AnnouncementStatus = 'draft' | 'scheduled' | 'sent' | 'archived';

/**
 * Platform communications managed from the Content & Communication Center:
 * announcements, templates, and campaigns. Audience is a free-form JSON
 * filter the delivery worker interprets. Table auto-created (DATABASE_SYNC).
 */
@Entity({ name: 'admin_announcements' })
@Index(['status', 'channel'])
export class AnnouncementEntity extends AppBaseEntity {
  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ length: 20, default: 'in_app' })
  channel!: AnnouncementChannel;

  @Column({ length: 20, default: 'draft' })
  status!: AnnouncementStatus;

  @Column({ type: 'jsonb', nullable: true })
  audience!: Record<string, unknown> | null;

  @Column({ name: 'scheduled_for', type: 'timestamptz', nullable: true })
  scheduledFor!: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'recipients_count', type: 'int', default: 0 })
  recipientsCount!: number;

  @Column({ name: 'engaged_count', type: 'int', default: 0 })
  engagedCount!: number;

  @Column({ name: 'created_by_staff_id', type: 'uuid', nullable: true })
  createdByStaffId!: string | null;
}
