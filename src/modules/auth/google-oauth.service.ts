import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { ActivityService } from '../activity/activity.service';
import { MembershipsService } from '../memberships/memberships.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AuthService } from './auth.service';
import type { AuthResponseDto } from './dto/auth-response.dto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPES = ['openid', 'email', 'profile'].join(' ');

interface OAuthState {
  intent: 'signin' | 'signup_individual' | 'signup_organization';
  redirectAfter: string | null;
  inviteToken: string | null;
  organizationName?: string;
  organizationRole?: string;
  organizationTeamSize?: number;
}

/**
 * Google "Sign in with Google" flow — separate from the
 * `IntegrationsService.completeGoogleOAuth` path used to connect a
 * workspace to Drive/Gmail. That one captures access tokens for the
 * org's tools; this one is identity-only.
 *
 * Flow:
 *   1. Frontend hits POST /auth/google/url with `intent` + (org fields).
 *   2. Service returns the Google consent URL with a signed `state` blob.
 *   3. Browser sends user to Google.
 *   4. Google redirects to /auth/google/callback?code=...&state=...
 *   5. Service exchanges code for tokens, fetches userinfo, finds-or-
 *      -creates the user, optionally provisions the org, returns a JWT.
 *
 * Required env (set after creating an OAuth client at
 * console.cloud.google.com → Credentials → "OAuth 2.0 Client IDs"):
 *   - GOOGLE_AUTH_CLIENT_ID
 *   - GOOGLE_AUTH_CLIENT_SECRET
 *   - GOOGLE_AUTH_REDIRECT_URI (e.g. https://stack62-api.onrender.com/v1/auth/google/callback)
 *   - APP_PUBLIC_URL (e.g. https://stack62-web.onrender.com) — where we
 *     redirect after a successful login (with #token=… in the URL)
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly workspacesService: WorkspacesService,
    private readonly membershipsService: MembershipsService,
    private readonly activityService: ActivityService,
    private readonly authService: AuthService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('GOOGLE_AUTH_CLIENT_ID') &&
        this.configService.get<string>('GOOGLE_AUTH_CLIENT_SECRET') &&
        this.configService.get<string>('GOOGLE_AUTH_REDIRECT_URI'),
    );
  }

  buildConsentUrl(state: OAuthState): string {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. The operator needs to set GOOGLE_AUTH_CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET, and GOOGLE_AUTH_REDIRECT_URI.',
      );
    }
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set(
      'client_id',
      this.configService.get<string>('GOOGLE_AUTH_CLIENT_ID')!,
    );
    url.searchParams.set(
      'redirect_uri',
      this.configService.get<string>('GOOGLE_AUTH_REDIRECT_URI')!,
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('state', this.encodeState(state));
    return url.toString();
  }

  async handleCallback(
    code: string,
    rawState: string,
  ): Promise<{ auth: AuthResponseDto; redirectAfter: string | null }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured.',
      );
    }
    const state = this.decodeState(rawState);
    const tokens = await this.exchangeCode(code);
    const profile = await this.fetchUserInfo(tokens.access_token);

    if (!profile.email || !profile.email_verified) {
      throw new BadRequestException(
        'Google account email is missing or not verified.',
      );
    }

    let user = await this.usersService.findByEmail(profile.email);
    if (!user) {
      user = await this.usersService.create({
        email: profile.email,
        passwordHash: await argon2.hash(crypto.randomBytes(32).toString('hex')),
        firstName: profile.given_name || 'Stack62',
        lastName: profile.family_name || 'User',
      });
      await this.activityService.log({
        actorUserId: user.id,
        action: 'auth.register',
        targetType: 'user',
        targetId: user.id,
        origin: 'user',
        metadata: {
          email: user.email,
          provider: 'google',
          accountType: state.intent === 'signup_organization' ? 'organization' : 'individual',
        },
      });

      // Mirror what AuthService.register would do.
      if (state.inviteToken) {
        try {
          await this.membershipsService.acceptInvite(
            { token: state.inviteToken },
            user.id,
          );
        } catch {
          await this.bootstrapPersonalOrg(user.id, user.firstName);
        }
      } else if (
        state.intent === 'signup_organization' &&
        state.organizationName
      ) {
        const org = await this.organizationsService.create(
          {
            name: state.organizationName,
            ...(state.organizationRole
              ? {
                  description: `Created by ${user.firstName} (${state.organizationRole})`,
                }
              : {}),
          },
          user.id,
        );
        const ws = await this.workspacesService.create(
          { organizationId: org.id, name: 'Main' },
          user.id,
        );
        await this.membershipsService.create(
          {
            userId: user.id,
            organizationId: org.id,
            workspaceId: ws.id,
            role: 'owner',
          },
          user.id,
        );
      } else {
        await this.bootstrapPersonalOrg(user.id, user.firstName);
      }
    } else {
      await this.activityService.log({
        actorUserId: user.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        origin: 'user',
        metadata: { email: user.email, provider: 'google' },
      });
    }

    return {
      auth: this.authService.buildAuthResponse(user),
      redirectAfter: state.redirectAfter,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async bootstrapPersonalOrg(userId: string, firstName: string) {
    const org = await this.organizationsService.create(
      {
        name: `${firstName}'s Workspace`,
        description: 'Personal account',
      },
      userId,
    );
    const ws = await this.workspacesService.create(
      { organizationId: org.id, name: 'Personal' },
      userId,
    );
    await this.membershipsService.create(
      {
        userId,
        organizationId: org.id,
        workspaceId: ws.id,
        role: 'owner',
      },
      userId,
    );
  }

  private encodeState(state: OAuthState): string {
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

  private decodeState(raw: string): OAuthState {
    const [payload, sig] = raw.split('.');
    if (!payload || !sig) {
      throw new BadRequestException('Invalid OAuth state.');
    }
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const secret = this.configService.get<string>(
      'JWT_SECRET',
      'stack62-local-development-secret',
    );
    const expected = crypto
      .createHmac('sha256', secret)
      .update(json)
      .digest('base64url');
    if (sig !== expected) {
      throw new BadRequestException('OAuth state signature mismatch.');
    }
    try {
      return JSON.parse(json) as OAuthState;
    } catch {
      throw new BadRequestException('Malformed OAuth state.');
    }
  }

  private async exchangeCode(code: string): Promise<{
    access_token: string;
    expires_in: number;
    token_type: string;
    id_token: string;
  }> {
    const params = new URLSearchParams({
      code,
      client_id: this.configService.get<string>('GOOGLE_AUTH_CLIENT_ID')!,
      client_secret: this.configService.get<string>(
        'GOOGLE_AUTH_CLIENT_SECRET',
      )!,
      redirect_uri: this.configService.get<string>(
        'GOOGLE_AUTH_REDIRECT_URI',
      )!,
      grant_type: 'authorization_code',
    });
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Google token exchange failed: ${text}`);
      throw new BadRequestException('Google sign-in failed at token exchange.');
    }
    return res.json() as Promise<{
      access_token: string;
      expires_in: number;
      token_type: string;
      id_token: string;
    }>;
  }

  private async fetchUserInfo(accessToken: string): Promise<{
    sub: string;
    email: string;
    email_verified: boolean;
    given_name?: string;
    family_name?: string;
    name?: string;
    picture?: string;
  }> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new BadRequestException('Could not fetch Google userinfo.');
    }
    return res.json() as Promise<{
      sub: string;
      email: string;
      email_verified: boolean;
      given_name?: string;
      family_name?: string;
      name?: string;
      picture?: string;
    }>;
  }
}
