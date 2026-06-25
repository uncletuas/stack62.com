import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Capability, PlatformRole } from './platform-staff.constants';

export const REQUIRE_CAPABILITY_KEY = 'admin:requireCapability';
export const REQUIRE_ROLE_KEY = 'admin:requireRole';

/** Endpoint requires the staff member's role to grant this capability. */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, capability);

/** Endpoint requires the staff member to hold one of these exact roles. */
export const RequirePlatformRole = (...roles: PlatformRole[]) =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);

export interface AuthenticatedStaff {
  staffId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
}

/** Injects the authenticated staff member resolved by PlatformStaffGuard. */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const request = ctx.switchToHttp().getRequest();
    return request.staff as AuthenticatedStaff;
  },
);
