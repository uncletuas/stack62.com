/**
 * Platform-level roles for the Stack62 "Assembly" administrative backend.
 *
 * These are distinct from the tenant (org-membership) roles handled by the
 * TenantAccessGuard. A platform role is stored on the user row
 * (`users.platform_role`) and is null for ordinary customers — only Loopital
 * staff carry one. `super_admin` implies access to every module.
 */
export const PLATFORM_ROLES = [
  'super_admin',
  'finance_manager',
  'support_manager',
  'engineer',
  'security_officer',
  'operations_manager',
  'executive',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    typeof value === 'string' &&
    (PLATFORM_ROLES as readonly string[]).includes(value)
  );
}

/**
 * The 16 Assembly modules. The frontend nav and per-route guards both key
 * off these identifiers, and the admin API surface is grouped by them.
 */
export const ADMIN_MODULES = [
  'dashboard',
  'users',
  'organizations',
  'billing',
  'support',
  'content',
  'security',
  'audit',
  'ai',
  'integrations',
  'infra',
  'config',
  'observability',
  'executive',
  'roles',
  'activity',
] as const;

export type AdminModuleKey = (typeof ADMIN_MODULES)[number];

/**
 * Which modules each platform role may reach. `super_admin` gets everything.
 * Keep this in sync with the frontend `useAdminAuth` helper — the backend is
 * the source of truth (the guard enforces it; the nav merely reflects it).
 */
export const ROLE_MODULE_ACCESS: Record<PlatformRole, readonly AdminModuleKey[]> =
  {
    super_admin: ADMIN_MODULES,
    finance_manager: [
      'dashboard',
      'billing',
      'organizations',
      'executive',
      'audit',
      'activity',
    ],
    support_manager: [
      'dashboard',
      'users',
      'organizations',
      'support',
      'content',
      'activity',
    ],
    engineer: [
      'dashboard',
      'infra',
      'config',
      'observability',
      'integrations',
      'ai',
      'activity',
    ],
    security_officer: [
      'dashboard',
      'security',
      'audit',
      'users',
      'roles',
      'activity',
    ],
    operations_manager: [
      'dashboard',
      'users',
      'organizations',
      'support',
      'observability',
      'activity',
    ],
    executive: ['dashboard', 'executive', 'billing', 'observability', 'activity'],
  };

/** Returns the modules a role may access (super_admin → all). */
export function modulesForRole(role: PlatformRole): readonly AdminModuleKey[] {
  return ROLE_MODULE_ACCESS[role] ?? [];
}

/** Whether a role may reach a given module. */
export function roleCanAccessModule(
  role: PlatformRole,
  module: AdminModuleKey,
): boolean {
  if (role === 'super_admin') return true;
  return modulesForRole(role).includes(module);
}
