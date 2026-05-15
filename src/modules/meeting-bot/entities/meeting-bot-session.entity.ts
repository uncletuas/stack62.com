import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type MeetingBotStatus =
  | 'queued' // job sitting in BullMQ
  | 'joining' // worker spinning up Playwright + navigating
  | 'in_meeting' // bot is in the call, captions streaming
  | 'summarising' // call ended, Claude summarising
  | 'completed' // summary posted, done
  | 'failed' // join refused, captcha, crash, etc.
  | 'cancelled'; // user cancelled before completion

export type MeetingProvider = 'google-meet';

/**
 * One row per "Coworker, attend my meeting" request. The worker
 * service consumes the BullMQ queue, joins via Playwright, scrapes
 * live captions into MeetingBotTranscript rows, and on call-end posts
 * a summary message into the user's Coworker room.
 *
 * Only Google Meet is supported in v1 (per current scope). Zoom/Teams
 * deferred — see docs/meeting-bot.md.
 */
@Entity({ name: 'meeting_bot_sessions' })
@Index(['organizationId', 'status'])
@Index(['workspaceId'])
export class MeetingBotSessionEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** User who asked the Coworker to attend. */
  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId!: string;

  /** Optional room id where the summary should be posted. */
  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId!: string | null;

  @Column({ length: 30, default: 'google-meet' })
  provider!: MeetingProvider;

  /** Meeting URL the bot joins. */
  @Column({ name: 'meeting_url', type: 'text' })
  meetingUrl!: string;

  /** Display name the bot uses when joining. */
  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 80,
    default: 'Stack62 Coworker',
  })
  displayName!: string;

  /** Optional user-supplied title; falls back to "Meeting on <date>". */
  @Column({ length: 200, nullable: true })
  title!: string | null;

  @Column({ length: 30, default: 'queued' })
  status!: MeetingBotStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  /** End-of-call summary written by Claude. */
  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  /** RoomMessage id where the summary landed (for deep-linking). */
  @Column({
    name: 'summary_message_id',
    type: 'uuid',
    nullable: true,
  })
  summaryMessageId!: string | null;

  /** Surface why a session failed so the requester sees it. */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
