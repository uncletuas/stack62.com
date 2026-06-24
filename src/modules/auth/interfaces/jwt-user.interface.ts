import type { PlatformRole } from '../../../shared/access-control/platform-roles';

export interface JwtUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Platform (Assembly) role; null for ordinary customers. */
  platformRole: PlatformRole | null;
}
