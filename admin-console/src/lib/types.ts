export type PlatformRole =
  | 'super_admin'
  | 'engineer'
  | 'support_agent'
  | 'support_lead'
  | 'billing_ops'
  | 'security_officer'
  | 'analyst';

export interface AuthenticatedStaff {
  staffId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
}

export interface StaffRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
  status: 'active' | 'suspended';
  twoFactorEnabled: boolean;
  mustResetPassword: boolean;
  allowedIps: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  origin: string;
  metadata: Record<string, unknown> | null;
}

export const ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: 'Super Admin',
  engineer: 'Platform Engineer / SRE',
  support_agent: 'Support Agent',
  support_lead: 'Support Lead',
  billing_ops: 'Billing / Finance',
  security_officer: 'Security Officer',
  analyst: 'Analyst (read-only)',
};
