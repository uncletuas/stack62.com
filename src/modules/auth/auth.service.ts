import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { MembershipsService } from '../memberships/memberships.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ActivityService } from '../activity/activity.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly workspacesService: WorkspacesService,
    private readonly membershipsService: MembershipsService,
    private readonly jwtService: JwtService,
    private readonly activityService: ActivityService,
    private readonly configService: ConfigService,
  ) {}

  async register(
    payload: RegisterDto,
    signupIp?: string | null,
  ): Promise<AuthResponseDto> {
    const passwordHash = await argon2.hash(payload.password);
    const user = await this.usersService.create({
      email: payload.email,
      passwordHash,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    // Best-effort signup geography for analytics — never blocks registration.
    void this.usersService.recordSignupGeo(user.id, signupIp);

    await this.activityService.log({
      actorUserId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: {
        email: user.email,
        accountType: payload.accountType ?? 'individual',
        ...(payload.organizationName
          ? { organizationName: payload.organizationName }
          : {}),
        ...(payload.organizationRole
          ? { organizationRole: payload.organizationRole }
          : {}),
      },
    });

    // ── Invite path: the user is joining an existing org. Skip personal
    // org creation; the membership service will attach them.
    if (payload.inviteToken) {
      try {
        await this.membershipsService.acceptInvite(
          { token: payload.inviteToken },
          user.id,
        );
      } catch {
        // Don't block registration if the token is bad — they still get
        // the personal org so the app is usable.
        await this.bootstrapPersonalOrg(user.id, user.firstName);
      }
      return this.buildAuthResponse(user);
    }

    // ── Organization path: capture org name + role on the membership row.
    if (payload.accountType === 'organization' && payload.organizationName) {
      const org = await this.organizationsService.create(
        {
          name: payload.organizationName,
          ...(payload.organizationRole
            ? {
                description: `Created by ${user.firstName} (${payload.organizationRole})`,
              }
            : {}),
        },
        user.id,
      );
      const workspace = await this.workspacesService.create(
        {
          organizationId: org.id,
          name: 'Main',
        },
        user.id,
      );
      await this.membershipsService.create(
        {
          userId: user.id,
          organizationId: org.id,
          workspaceId: workspace.id,
          role: 'owner',
        },
        user.id,
      );
      return this.buildAuthResponse(user);
    }

    // ── Individual path: create a private "Personal" org + workspace so
    // the multi-tenant model still applies, but the UI hides them.
    await this.bootstrapPersonalOrg(user.id, user.firstName);
    return this.buildAuthResponse(user);
  }

  private async bootstrapPersonalOrg(userId: string, firstName: string) {
    const org = await this.organizationsService.create(
      {
        name: `${firstName}'s Workspace`,
        description: 'Personal account',
      },
      userId,
    );
    const workspace = await this.workspacesService.create(
      {
        organizationId: org.id,
        name: 'Personal',
      },
      userId,
    );
    await this.membershipsService.create(
      {
        userId,
        organizationId: org.id,
        workspaceId: workspace.id,
        role: 'owner',
      },
      userId,
    );
  }

  async login(payload: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(payload.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordValid = await argon2.verify(
      user.passwordHash,
      payload.password,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    await this.activityService.log({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });

    return this.buildAuthResponse(user);
  }

  /**
   * Single sign-on from loopital.com. Validates the short-lived SSO token with
   * loopital's IdP, then finds-or-creates a Stack62 user keyed by the loopital
   * email and issues Stack62's own session — so one loopital account signs into
   * Stack62. See loopital.com docs/SSO_INTEGRATION.md.
   */
  async loopitalSso(token: string): Promise<AuthResponseDto> {
    const base = this.configService.get<string>(
      'LOOPITAL_API_BASE',
      'https://www.loopital.com/api',
    );
    let loopitalUser: { id: string; name?: string; email: string } | undefined;
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/sso/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, product: 'stack62' }),
      });
      if (!res.ok) throw new Error('exchange failed');
      const data = (await res.json()) as {
        user?: { id: string; name?: string; email: string };
      };
      loopitalUser = data.user;
    } catch {
      throw new UnauthorizedException('Could not verify your loopital sign-in.');
    }
    if (!loopitalUser?.email) {
      throw new UnauthorizedException('loopital sign-in returned no account.');
    }

    const email = loopitalUser.email.toLowerCase();
    let user = await this.usersService.findByEmail(email);
    if (!user) {
      const [firstName, ...rest] = (loopitalUser.name ?? '').trim().split(/\s+/);
      user = await this.usersService.create({
        email,
        passwordHash: await argon2.hash(crypto.randomBytes(32).toString('hex')),
        firstName: firstName || 'Stack62',
        lastName: rest.join(' ') || 'User',
      });
      await this.activityService.log({
        actorUserId: user.id,
        action: 'auth.register',
        targetType: 'user',
        targetId: user.id,
        origin: 'user',
        metadata: { email: user.email, provider: 'loopital' },
      });
      await this.bootstrapPersonalOrg(user.id, user.firstName);
    } else {
      await this.activityService.log({
        actorUserId: user.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        origin: 'user',
        metadata: { email: user.email, provider: 'loopital' },
      });
    }

    return this.buildAuthResponse(user);
  }

  /**
   * Build a JWT response for a given user. Used by both the password flow
   * and the Google OAuth flow.
   */
  buildAuthResponse(
    user: Awaited<ReturnType<UsersService['findById']>>,
  ): AuthResponseDto {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    return {
      accessToken,
      user: this.usersService.sanitize(user),
    };
  }
}
