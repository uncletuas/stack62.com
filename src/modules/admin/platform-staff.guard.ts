import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_JWT_AUDIENCE,
  Capability,
  PlatformRole,
  roleHasCapability,
} from './platform-staff.constants';
import {
  REQUIRE_CAPABILITY_KEY,
  REQUIRE_ROLE_KEY,
} from './admin.decorators';
import { PlatformStaffService } from './platform-staff.service';

interface AdminJwtPayload {
  sub: string;
  email: string;
  role: PlatformRole;
  aud: string;
}

/**
 * Authenticates platform staff and enforces capability/role requirements.
 *
 * Admin controllers are marked @Public() so the GLOBAL customer JwtAuthGuard
 * skips them — this guard is then the sole authority on /v1/admin/*. It:
 *   1. verifies a Bearer JWT signed with ADMIN_JWT_SECRET and audience 'admin'
 *      (a customer token has no such audience, so it can never pass here),
 *   2. loads the staff row and rejects suspended accounts,
 *   3. enforces @RequireCapability / @RequirePlatformRole metadata,
 *   4. enforces the per-staff IP allowlist when SECURITY_ENABLE_IP_ALLOWLIST=true.
 */
@Injectable()
export class PlatformStaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly staffService: PlatformStaffService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing admin credentials.');
    }

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminJwtPayload>(token, {
        secret: this.adminSecret(),
        audience: ADMIN_JWT_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired admin session.');
    }

    const staff = await this.staffService.findById(payload.sub).catch(() => null);
    if (!staff || staff.status !== 'active') {
      throw new UnauthorizedException('Staff account not active.');
    }

    this.enforceIpAllowlist(staff.allowedIps, request);

    const requiredRoles = this.reflector.getAllAndOverride<PlatformRole[]>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length && !requiredRoles.includes(staff.role)) {
      throw new ForbiddenException('Insufficient role for this action.');
    }

    const requiredCapability = this.reflector.getAllAndOverride<Capability>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredCapability && !roleHasCapability(staff.role, requiredCapability)) {
      throw new ForbiddenException(
        `Your role (${staff.role}) lacks the required capability: ${requiredCapability}.`,
      );
    }

    request.staff = {
      staffId: staff.id,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      role: staff.role,
    };
    return true;
  }

  private extractToken(request: {
    headers: Record<string, string | undefined>;
  }): string | null {
    const header = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
  }

  private adminSecret(): string {
    return this.configService.get<string>(
      'ADMIN_JWT_SECRET',
      'stack62-admin-development-secret',
    );
  }

  private enforceIpAllowlist(
    allowedIps: string[] | null,
    request: { ip?: string; headers: Record<string, string | undefined> },
  ): void {
    const enabled = this.configService.get<boolean>(
      'SECURITY_ENABLE_IP_ALLOWLIST',
      false,
    );
    if (!enabled || !allowedIps || allowedIps.length === 0) return;

    const forwarded = request.headers['x-forwarded-for'];
    const clientIp =
      (forwarded ? forwarded.split(',')[0].trim() : undefined) ??
      request.ip ??
      '';
    if (!allowedIps.includes(clientIp)) {
      throw new ForbiddenException('Access from this IP address is not allowed.');
    }
  }
}
