import { Column, Entity, Index, Unique } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A bidirectional mapping between a Stack62 Coworker Room and a Slack
 * channel. While the mapping is active, messages flow both ways:
 *   • new RoomMessage in Stack62 → chat.postMessage to Slack
 *   • new message event in Slack → RoomMessage in Stack62 (authored
 *     by the Slack user mapped to a Stack62 user if known, else
 *     authored as `coworker` with the Slack display name in metadata)
 *
 * `direction` lets operators flip to one-way bridging if needed.
 */
@Entity({ name: 'slack_channel_mappings' })
@Index(['organizationId'])
@Index(['slackChannelId'])
@Unique(['installationId', 'slackChannelId'])
export class SlackChannelMappingEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'installation_id', type: 'uuid' })
  installationId!: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId!: string;

  @Column({ name: 'slack_channel_id', type: 'varchar', length: 40 })
  slackChannelId!: string;

  @Column({
    name: 'slack_channel_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  slackChannelName!: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'bidirectional',
  })
  direction!: 'bidirectional' | 'slack_to_stack62' | 'stack62_to_slack';

  @Column({ default: true })
  enabled!: boolean;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;
}
