/**
 * Platform staff roles ("positions") and the capabilities each one grants.
 *
 * A capability is an `area.action` string (e.g. `billing.edit`). Endpoints
 * declare the capability they need with `@RequireCapability('area.action')`
 * and PlatformStaffGuard checks it against the staff member's role. This lets
 * us re-shape who-can-do-what by editing this one map, never the endpoints.
 *
 * `'*'` is a wildcard meaning "all capabilities" (super admin only).
 */
export type PlatformRole =
  | 'super_admin'
  | 'engineer'
  | 'support_agent'
  | 'support_lead'
  | 'billing_ops'
  | 'security_officer'
  | 'analyst';

export const PLATFORM_ROLES: PlatformRole[] = [
  'super_admin',
  'engineer',
  'support_agent',
  'support_lead',
  'billing_ops',
  'security_officer',
  'analyst',
];

export type Capability =
  // staff administration
  | 'staff.read'
  | 'staff.manage'
  // audit log
  | 'audit.read'
  // customers & support
  | 'customer.read'
  | 'customer.support'
  | 'customer.impersonate'
  | 'customer.reset_password'
  | 'customer.escalate'
  // billing
  | 'billing.read'
  | 'billing.edit'
  | 'billing.refund'
  // runtime config
  | 'config.read'
  | 'config.edit'
  // security parameters
  | 'security.read'
  | 'security.edit'
  // AI management
  | 'ai.read'
  // API & integrations
  | 'integrations.read'
  | 'integrations.edit'
  // content & communications
  | 'content.read'
  | 'content.edit'
  // monitoring / health / errors
  | 'monitoring.read'
  // engineering ops (approval-gated)
  | 'engineering.migrate'
  | 'engineering.deploy'
  | 'engineering.rotate_keys'
  | 'engineering.trigger'
  | 'approvals.approve'
  // system controls (maintenance, read-only, rate-limit) + database
  | 'system.read'
  | 'system.control'
  | 'database.read'
  | 'database.backup';

/**
 * Role → capabilities. super_admin holds the wildcard. The rest are scoped to
 * their job, with read-mostly roles (analyst, security_officer) kept narrow.
 */
export const ROLE_CAPABILITIES: Record<PlatformRole, Capability[] | ['*']> = {
  super_admin: ['*'],
  engineer: [
    'config.read',
    'config.edit',
    'monitoring.read',
    'engineering.migrate',
    'engineering.deploy',
    'engineering.rotate_keys',
    'engineering.trigger',
    'audit.read',
    'staff.read',
    'system.read',
    'system.control',
    'database.read',
    'database.backup',
    'ai.read',
    'integrations.read',
    'integrations.edit',
  ],
  support_agent: [
    'customer.read',
    'customer.support',
    'customer.impersonate',
    'customer.reset_password',
    'audit.read',
    'content.read',
  ],
  support_lead: [
    'customer.read',
    'customer.support',
    'customer.impersonate',
    'customer.reset_password',
    'customer.escalate',
    'billing.refund',
    'audit.read',
    'staff.read',
    'content.read',
    'content.edit',
  ],
  billing_ops: [
    'billing.read',
    'billing.edit',
    'billing.refund',
    'customer.read',
    'audit.read',
  ],
  security_officer: [
    'security.read',
    'security.edit',
    'audit.read',
    'monitoring.read',
    'staff.read',
    'system.read',
    'system.control',
    'database.read',
    // Can act as the second approver for engineering ops (not high-risk ones,
    // which still require a super_admin approver).
    'approvals.approve',
  ],
  analyst: [
    'monitoring.read',
    'audit.read',
    'customer.read',
    'billing.read',
    'config.read',
    'system.read',
    'database.read',
    'ai.read',
    'integrations.read',
    'content.read',
  ],
};

export function roleHasCapability(
  role: PlatformRole,
  capability: Capability,
): boolean {
  const granted = ROLE_CAPABILITIES[role];
  if (!granted) return false;
  if ((granted as string[]).includes('*')) return true;
  return (granted as Capability[]).includes(capability);
}

// JWT audiences. A customer token (no audience) can never satisfy these, and
// the short-lived 2FA challenge token can never satisfy a full-access route.
export const ADMIN_JWT_AUDIENCE = 'admin';
export const ADMIN_2FA_AUDIENCE = 'admin-2fa';
