import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import {
  ADMIN_2FA_AUDIENCE,
  ADMIN_JWT_AUDIENCE,
} from './platform-staff.constants';
import { PlatformStaffEntity } from './entities/platform-staff.entity';
import { PlatformStaffService } from './platform-staff.service';
import { TotpService } from './totp.service';

interface ChallengePayload {
  sub: string;
  aud: string;
}

export type LoginResult =
  | { status: 'totp_required'; challengeToken: string }
  | { status: 'setup_required'; challengeToken: string };

export interface AdminSession {
  accessToken: string;
  staff: ReturnType<PlatformStaffService['sanitize']>;
}

/**
 * Two-step staff authentication:
 *   1. login (email + password) → a short-lived challenge token (aud admin-2fa).
 *      Never returns a usable session on its own — 2FA is mandatory.
 *   2a. setup-2fa (first time)  → returns an otpauth URI to enrol an app.
 *   2b. verify-2fa              → checks the TOTP code, then issues the real
 *                                 access token (aud admin) used for /v1/admin/*.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly staffService: PlatformStaffService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly totpService: TotpService,
    private readonly auditService: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    sourceIp?: string,
  ): Promise<LoginResult> {
    const staff = await this.staffService.findByEmail(email);
    // Constant-ish failure: same message whether email or password is wrong.
    if (!staff || staff.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials.');
    }
    const ok = await this.staffService.verifyPassword(staff, password);
    if (!ok) {
      await this.audit(staff, 'admin.auth.login_failed', sourceIp);
      throw new UnauthorizedException('Invalid credentials.');
    }

    const challengeToken = this.signChallenge(staff);
    const needsSetup = !staff.twoFactorEnabledAt;
    await this.audit(
      staff,
      needsSetup ? 'admin.auth.login_setup_required' : 'admin.auth.login_totp',
      sourceIp,
    );
    return {
      status: needsSetup ? 'setup_required' : 'totp_required',
      challengeToken,
    };
  }

  /**
   * Begin (or restart) 2FA enrolment. Allowed only while 2FA is not yet
   * enabled — re-enrolment of an active device is done by an admin reset.
   * Returns the secret + otpauth URI; the client renders the QR.
   */
  async setupTwoFactor(
    challengeToken: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const staff = await this.resolveChallenge(challengeToken);
    if (staff.twoFactorEnabledAt) {
      throw new BadRequestException('2FA is already enabled for this account.');
    }
    const secret = this.totpService.generateSecret();
    await this.staffService.storePendingTwoFactorSecret(staff.id, secret);
    return {
      secret,
      otpauthUri: this.totpService.provisioningUri(secret, staff.email),
    };
  }

  async verifyTwoFactor(
    challengeToken: string,
    code: string,
    sourceIp?: string,
  ): Promise<AdminSession> {
    const staff = await this.resolveChallenge(challengeToken);
    const secret = this.staffService.getDecryptedTwoFactorSecret(staff);
    if (!secret) {
      throw new BadRequestException('Set up 2FA before verifying a code.');
    }
    if (!this.totpService.verify(secret, code)) {
      await this.audit(staff, 'admin.auth.2fa_failed', sourceIp);
      throw new UnauthorizedException('Invalid authentication code.');
    }

    const firstEnrolment = !staff.twoFactorEnabledAt;
    if (firstEnrolment) {
      await this.staffService.markTwoFactorEnabled(staff.id);
    }
    await this.staffService.recordLogin(staff.id);
    await this.audit(
      staff,
      firstEnrolment ? 'admin.auth.2fa_enrolled' : 'admin.auth.login_success',
      sourceIp,
    );

    const fresh = await this.staffService.getByIdOrThrow(staff.id);
    return {
      accessToken: this.signAccess(fresh),
      staff: this.staffService.sanitize(fresh),
    };
  }

  // ── token helpers ───────────────────────────────────────────────────────

  private signChallenge(staff: PlatformStaffEntity): string {
    return this.jwtService.sign(
      { sub: staff.id },
      {
        secret: this.secret(),
        audience: ADMIN_2FA_AUDIENCE,
        expiresIn: this.configService.get<string>(
          'ADMIN_2FA_CHALLENGE_EXPIRES_IN',
          '10m',
        ) as never,
      },
    );
  }

  private signAccess(staff: PlatformStaffEntity): string {
    return this.jwtService.sign(
      { sub: staff.id, email: staff.email, role: staff.role },
      {
        secret: this.secret(),
        audience: ADMIN_JWT_AUDIENCE,
        expiresIn: this.configService.get<string>(
          'ADMIN_JWT_EXPIRES_IN',
          '8h',
        ) as never,
      },
    );
  }

  private async resolveChallenge(
    challengeToken: string,
  ): Promise<PlatformStaffEntity> {
    let payload: ChallengePayload;
    try {
      payload = this.jwtService.verify<ChallengePayload>(challengeToken, {
        secret: this.secret(),
        audience: ADMIN_2FA_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Login session expired. Sign in again.');
    }
    const staff = await this.staffService.findById(payload.sub);
    if (!staff || staff.status !== 'active') {
      throw new UnauthorizedException('Staff account not active.');
    }
    return staff;
  }

  private secret(): string {
    return this.configService.get<string>(
      'ADMIN_JWT_SECRET',
      'stack62-admin-development-secret',
    );
  }

  private async audit(
    staff: PlatformStaffEntity,
    action: string,
    sourceIp?: string,
  ): Promise<void> {
    await this.auditService.log({
      actorUserId: staff.id,
      action,
      targetType: 'platform_staff',
      targetId: staff.id,
      origin: 'system',
      metadata: { role: staff.role, email: staff.email, sourceIp: sourceIp ?? null },
    });
  }
}
