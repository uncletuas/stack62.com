import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * Idempotency + dedup record. Every time a message crosses the
 * Slack ↔ Stack62 boundary we store the (slack_ts, stack62 message id)
 * pair so we don't echo the same content twice when Slack delivers a
 * `message` event for a post we ourselves just made.
 */
@Entity({ name: 'slack_message_links' })
@Index(['roomMessageId'])
@Unique(['slackChannelId', 'slackMessageTs'])
export class SlackMessageLinkEntity extends AppBaseEntity {
  @Column({ name: 'room_message_id', type: 'uuid' })
  roomMessageId!: string;

  @Column({ name: 'slack_channel_id', type: 'varchar', length: 40 })
  slackChannelId!: string;

  /** Slack's message timestamp string (e.g. "1730122545.001200"). */
  @Column({ name: 'slack_message_ts', type: 'varchar', length: 40 })
  slackMessageTs!: string;

  @Column({ type: 'varchar', length: 30, default: 'outbound' })
  direction!: 'outbound' | 'inbound';
}
