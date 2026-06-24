import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PlatformRoleGuard } from './platform-role.guard';
import type { PlatformRole } from './platform-roles';

export const PLATFORM_ROLE_METADATA_KEY = 'stack62:platform-roles';

/**
 * Restrict a controller or handler to the Assembly. Pass the platform roles
 * permitted to use it; `super_admin` is always allowed implicitly. With no
 * arguments, any non-null platform role is accepted.
 *
 *   @PlatformRoles('finance_manager')   // finance + super_admin
 *   @PlatformRoles()                     // any Loopital staff
 *
 * The global JwtAuthGuard handles authentication; this only adds the
 * platform-role check.
 */
export function PlatformRoles(...roles: PlatformRole[]) {
  return applyDecorators(
    SetMetadata(PLATFORM_ROLE_METADATA_KEY, roles),
    UseGuards(PlatformRoleGuard),
  );
}
