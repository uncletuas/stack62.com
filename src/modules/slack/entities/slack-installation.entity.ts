import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * One row per Slack workspace connected to a Stack62 organization. The
 * bot access token authenticates outbound posts (Stack62 → Slack);
 * inbound events are authenticated via SLACK_SIGNING_SECRET at the
 * webhook boundary. Tokens are encrypted at rest via SecretEncryptionService
 * (AES-256-GCM) before being persisted by SlackOauthService.
 */
@Entity({ name: 'slack_installations' })
@Index(['organizationId'])
@Index(['teamId'], { unique: true })
export class SlackInstallationEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** Slack `team.id` — globally unique workspace identifier. */
  @Column({ name: 'team_id', type: 'varchar', length: 40 })
  teamId!: string;

  @Column({ name: 'team_name', type: 'varchar', length: 200, nullable: true })
  teamName!: string | null;

  /** Slack `bot_user_id` — used to detect mentions of our app. */
  @Column({ name: 'bot_user_id', type: 'varchar', length: 40 })
  botUserId!: string;

  /** `xoxb-…` token returned by OAuth, stored AES-256-GCM encrypted. */
  @Column({ name: 'bot_access_token', type: 'text' })
  botAccessToken!: string;

  @Column({ type: 'jsonb', nullable: true })
  scopes!: string[] | null;

  @Column({ name: 'enterprise_id', type: 'varchar', length: 40, nullable: true })
  enterpriseId!: string | null;

  @Column({ name: 'installed_by_user_id', type: 'uuid' })
  installedByUserId!: string;

  @Column({ name: 'app_id', type: 'varchar', length: 40, nullable: true })
  appId!: string | null;

  @Column({ default: true })
  active!: boolean;
}
