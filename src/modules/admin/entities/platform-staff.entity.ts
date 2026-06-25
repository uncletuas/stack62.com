import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';
import type { PlatformRole } from '../platform-staff.constants';

export type PlatformStaffStatus = 'active' | 'suspended';

/**
 * A Stack62 staff member who operates the platform from the admin console
 * (assembly.loopital.com). DELIBERATELY separate from `users` (customers):
 * staff have their own login surface, their own JWT audience, mandatory 2FA,
 * and an optional IP allowlist. A customer account can never become staff by
 * flipping a column — the two identity systems do not overlap.
 */
@Entity({ name: 'platform_staff' })
export class PlatformStaffEntity extends AppBaseEntity {
  @Index({ unique: true })
  @Column({ length: 255 })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ name: 'first_name', length: 120 })
  firstName!: string;

  @Column({ name: 'last_name', length: 120 })
  lastName!: string;

  @Column({ length: 40 })
  role!: PlatformRole;

  @Column({ length: 20, default: 'active' })
  status!: PlatformStaffStatus;

  /**
   * TOTP shared secret (base32), stored encrypted at rest via
   * SecretEncryptionService. Null until the staff member runs 2FA setup.
   */
  @Column({ name: 'two_factor_secret', type: 'text', nullable: true })
  twoFactorSecret!: string | null;

  /** Set the first time a valid TOTP code is verified; gates full login. */
  @Column({ name: 'two_factor_enabled_at', type: 'timestamptz', nullable: true })
  twoFactorEnabledAt!: Date | null;

  /**
   * Optional per-staff IP allowlist (CIDR or exact IPs). Enforced by
   * PlatformStaffGuard only when SECURITY_ENABLE_IP_ALLOWLIST=true.
   */
  @Column({ name: 'allowed_ips', type: 'jsonb', nullable: true })
  allowedIps!: string[] | null;

  /** Force a password change on next login (set for seeded/created accounts). */
  @Column({ name: 'must_reset_password', type: 'boolean', default: false })
  mustResetPassword!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  /** Staff id that created this account (null for the bootstrap super_admin). */
  @Column({ name: 'created_by_staff_id', type: 'uuid', nullable: true })
  createdByStaffId!: string | null;
}
