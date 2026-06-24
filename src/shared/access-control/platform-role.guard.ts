import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtUser } from '../../modules/auth/interfaces/jwt-user.interface';
import { PLATFORM_ROLE_METADATA_KEY } from './platform-role.decorator';
import type { PlatformRole } from './platform-roles';

/**
 * Guards the Assembly (`/v1/admin/*`) surface. Authentication is already
 * handled by the global JwtAuthGuard, so by the time this runs `request.user`
 * is populated. This guard only checks the platform role.
 *
 * `super_admin` is always allowed. When a handler declares specific roles via
 * `@PlatformRoles(...)`, the caller must hold one of them; when it declares
 * none (bare `@PlatformRoles()`), any non-null platform role is accepted.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<PlatformRole[] | undefined>(
        PLATFORM_ROLE_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;

    if (!user?.userId) {
      throw new UnauthorizedException('Authenticated user context is missing.');
    }

    const role = user.platformRole;
    if (!role) {
      throw new ForbiddenException('Administrative access is required.');
    }

    if (role === 'super_admin') return true;

    if (required.length > 0 && !required.includes(role)) {
      throw new ForbiddenException(
        'Your platform role does not permit this action.',
      );
    }

    return true;
  }
}
