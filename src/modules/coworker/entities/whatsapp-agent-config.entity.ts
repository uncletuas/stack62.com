import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export interface BusinessHours {
  /** IANA timezone, e.g. "Africa/Lagos". */
  timezone: string;
  /** Days the business is open: 0=Sun … 6=Sat. */
  days: number[];
  /** Local start time "HH:MM" (24h). */
  start: string;
  /** Local end time "HH:MM" (24h). */
  end: string;
}

/** When the coworker is allowed to auto-reply. */
export type ResponseSchedule = 'always' | 'business_hours' | 'after_hours';

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  timezone: 'Africa/Lagos',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
};

/**
 * Per-workspace configuration for how the coworker handles inbound WhatsApp
 * messages. This is the model behind the operator's controls: turn auto-reply
 * on/off, set when it replies, how it sounds, who it presents as, how long it
 * waits before replying, and what it knows about the business.
 */
@Entity({ name: 'whatsapp_agent_configs' })
@Index(['organizationId', 'workspaceId'], { unique: true })
export class WhatsAppAgentConfigEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Automatic coworker response on/off. */
  @Column({ name: 'auto_reply_enabled', default: false })
  autoReplyEnabled!: boolean;

  /** Time of response: when auto-reply is allowed to fire. */
  @Column({ name: 'response_schedule', length: 20, default: 'always' })
  responseSchedule!: ResponseSchedule;

  @Column({ name: 'business_hours', type: 'jsonb', nullable: true })
  businessHours!: BusinessHours | null;

  /** Manner of response — tone/style guidance for the reply. */
  @Column({ type: 'text', nullable: true })
  tone!: string | null;

  /** Response delay in seconds before the reply is sent (feels less robotic). */
  @Column({ name: 'response_delay_seconds', type: 'int', default: 5 })
  responseDelaySeconds!: number;

  /** Coworker identity: the name the coworker presents as on WhatsApp. */
  @Column({
    name: 'identity_name',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  identityName!: string | null;

  /** Coworker identity: role/title, e.g. "customer support for Acme". */
  @Column({
    name: 'identity_role',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  identityRole!: string | null;

  /** Optional signature appended to replies, e.g. "— Ada, Acme Support". */
  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  /** Business information the coworker uses to answer (hours, prices, FAQs…). */
  @Column({ name: 'business_info', type: 'text', nullable: true })
  businessInfo!: string | null;

  /** Sent when a message arrives outside the allowed response window. Optional. */
  @Column({ name: 'away_message', type: 'text', nullable: true })
  awayMessage!: string | null;

  /** Cap auto-replies per conversation per day (0 = unlimited). Loop guard. */
  @Column({ name: 'max_auto_replies_per_day', type: 'int', default: 0 })
  maxAutoRepliesPerDay!: number;
}
