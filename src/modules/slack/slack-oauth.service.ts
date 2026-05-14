import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { SlackInstallationEntity } from './entities/slack-installation.entity';

/**
 * Slack "Add to Slack" install flow.
 *
 * Flow:
 *   1. Admin visits POST /v1/slack/install/url with organizationId.
 *   2. We return a signed Slack OAuth URL containing the org + actor
 *      encoded in `state`.
 *   3. Browser → Slack consent → Slack redirects to /v1/slack/install/callback
 *   4. We exchange `code` for `xoxb-…` bot token, fetch team metadata,
 *      persist SlackInstallation, and bounce the user back to /app.
 *
 * Required env:
 *   SLACK_CLIENT_ID
 *   SLACK_CLIENT_SECRET
 *   SLACK_REDIRECT_URI    (defaults to APP_PUBLIC_URL + /v1/slack/install/callback)
 *   APP_PUBLIC_URL        (where to redirect after success)
 *
 * Default scopes match the v1 bridge surface (read channel messages,
 * post as the bot, look up users). Add `commands` once we ship the
 * /stack62 slash command.
 */
const SLACK_OAUTH_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_TOKEN = 'https://slack.com/api/oauth.v2.access';

const DEFAULT_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'chat:write.public',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'team:read',
  'users:read',
  'users:read.email',
].join(',');

interface InstallState {
  organizationId: string;
  actorUserId: string;
}

@Injectable()
export class SlackOAuthService {
  private readonly logger = new Logger(SlackOAuthService.name);

  constructor(
    @InjectRepository(SlackInstallationEntity)
    private readonly installationsRepo: Repository<SlackInstallationEntity>,
    private readonly configService: ConfigService,
    private readonly activityService: ActivityService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('SLACK_CLIENT_ID') &&
        this.configService.get<string>('SLACK_CLIENT_SECRET'),
    );
  }

  buildInstallUrl(state: InstallState): string {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Slack is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET on the API.',
      );
    }
    const url = new URL(SLACK_OAUTH_AUTHORIZE);
    url.searchParams.set(
      'client_id',
      this.configService.get<string>('SLACK_CLIENT_ID')!,
    );
    url.searchParams.set('scope', DEFAULT_BOT_SCOPES);
    url.searchParams.set('user_scope', '');
    url.searchParams.set('redirect_uri', this.redirectUri());
    url.searchParams.set('state', this.encodeState(state));
    return url.toString();
  }

  async handleCallback(
    code: string,
    rawState: string,
  ): Promise<{ installation: SlackInstallationEntity; appUrl: string }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Slack is not configured.');
    }
    const state = this.decodeState(rawState);
    const body = new URLSearchParams({
      code,
      client_id: this.configService.get<string>('SLACK_CLIENT_ID')!,
      client_secret: this.configService.get<string>('SLACK_CLIENT_SECRET')!,
      redirect_uri: this.redirectUri(),
    });
    const response = await fetch(SLACK_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await response.json()) as {
      ok: boolean;
      error?: string;
      access_token?: string;
      bot_user_id?: string;
      app_id?: string;
      team?: { id: string; name: string };
      enterprise?: { id?: string };
      scope?: string;
    };
    if (!response.ok || !json.ok) {
      this.logger.error(`Slack oauth.v2.access failed: ${JSON.stringify(json)}`);
      throw new BadRequestException(
        `Slack install failed: ${json.error || response.status}`,
      );
    }
    if (!json.access_token || !json.team?.id || !json.bot_user_id) {
      throw new BadRequestException('Slack response missing required fields.');
    }

    // Upsert by (organizationId, teamId). Re-installs refresh the token.
    let installation = await this.installationsRepo.findOne({
      where: { teamId: json.team.id },
    });
    if (installation) {
      installation.organizationId = state.organizationId;
      installation.botAccessToken = json.access_token;
      installation.botUserId = json.bot_user_id;
      installation.teamName = json.team.name ?? installation.teamName;
      installation.scopes = json.scope ? json.scope.split(',') : null;
      installation.appId = json.app_id ?? installation.appId;
      installation.enterpriseId =
        json.enterprise?.id ?? installation.enterpriseId;
      installation.installedByUserId = state.actorUserId;
      installation.active = true;
    } else {
      installation = this.installationsRepo.create({
        organizationId: state.organizationId,
        teamId: json.team.id,
        teamName: json.team.name ?? null,
        botUserId: json.bot_user_id,
        botAccessToken: json.access_token,
        scopes: json.scope ? json.scope.split(',') : null,
        appId: json.app_id ?? null,
        enterpriseId: json.enterprise?.id ?? null,
        installedByUserId: state.actorUserId,
        active: true,
      });
    }
    installation = await this.installationsRepo.save(installation);

    await this.activityService.log({
      organizationId: state.organizationId,
      actorUserId: state.actorUserId,
      action: 'slack.install',
      targetType: 'slack_installation',
      targetId: installation.id,
      origin: 'user',
      metadata: { teamId: installation.teamId, teamName: installation.teamName },
    });

    return {
      installation,
      appUrl:
        this.configService.get<string>('APP_PUBLIC_URL') ||
        'http://localhost:5173',
    };
  }

  async findByOrganization(
    organizationId: string,
  ): Promise<SlackInstallationEntity | null> {
    return this.installationsRepo.findOne({
      where: { organizationId, active: true },
    });
  }

  async findByTeamId(teamId: string): Promise<SlackInstallationEntity | null> {
    return this.installationsRepo.findOne({ where: { teamId, active: true } });
  }

  // ── State signing ─────────────────────────────────────────────────────

  private redirectUri(): string {
    return (
      this.configService.get<string>('SLACK_REDIRECT_URI') ||
      `${this.configService.get<string>('APP_PUBLIC_URL') || 'http://localhost:3000'}/v1/slack/install/callback`
    );
  }

  private encodeState(state: InstallState): string {
    const json = JSON.stringify(state);
    const secret = this.configService.get<string>(
      'JWT_SECRET',
      'stack62-local-development-secret',
    );
    const sig = crypto
      .createHmac('sha256', secret)
      .update(json)
      .digest('base64url');
    return `${Buffer.from(json).toString('base64url')}.${sig}`;
  }

  private decodeState(raw: string): InstallState {
    const [payload, sig] = raw.split('.');
    if (!payload || !sig)
      throw new BadRequestException('Invalid Slack OAuth state.');
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const secret = this.configService.get<string>(
      'JWT_SECRET',
      'stack62-local-development-secret',
    );
    const expected = crypto
      .createHmac('sha256', secret)
      .update(json)
      .digest('base64url');
    if (sig !== expected)
      throw new BadRequestException('Slack OAuth state signature mismatch.');
    try {
      return JSON.parse(json) as InstallState;
    } catch {
      throw new BadRequestException('Malformed Slack OAuth state.');
    }
  }
}
