import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';
import {
  type BusinessHours,
  type ResponseSchedule,
} from './whatsapp-agent-config.entity';

/**
 * Per-workspace configuration for how the coworker handles incoming email:
 * whether it proactively monitors and drafts replies, whether it may send
 * automatically (vs. draft-only for approval), when it's allowed to reply,
 * how it sounds, who it presents as, and what it knows about the business.
 */
@Entity({ name: 'email_agent_configs' })
@Index(['organizationId', 'workspaceId'], { unique: true })
export class EmailAgentConfigEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Proactively read incoming email and prepare a reply. */
  @Column({ name: 'enabled', default: false })
  enabled!: boolean;

  /**
   * When true the coworker sends its reply automatically; when false it only
   * drafts and notifies the user for approval (the safe default).
   */
  @Column({ name: 'auto_send', default: false })
  autoSend!: boolean;

  @Column({ name: 'response_schedule', length: 20, default: 'always' })
  responseSchedule!: ResponseSchedule;

  @Column({ name: 'business_hours', type: 'jsonb', nullable: true })
  businessHours!: BusinessHours | null;

  @Column({ type: 'text', nullable: true })
  tone!: string | null;

  @Column({
    name: 'identity_name',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  identityName!: string | null;

  @Column({
    name: 'identity_role',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  identityRole!: string | null;

  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  @Column({ name: 'business_info', type: 'text', nullable: true })
  businessInfo!: string | null;

  /** Cap auto-replies per day across the workspace (0 = unlimited). */
  @Column({ name: 'max_auto_replies_per_day', type: 'int', default: 20 })
  maxAutoRepliesPerDay!: number;
}
