import { apiRequest } from "../../lib/api";

/**
 * Thin typed wrappers over the shared `apiRequest` for the Assembly
 * (`/v1/admin/*`). Token handling, base URL, and error shaping are already
 * provided by `apiRequest` — this layer only adds paths + response types.
 */

export type PlatformRole =
  | "super_admin"
  | "finance_manager"
  | "support_manager"
  | "engineer"
  | "security_officer"
  | "operations_manager"
  | "executive";

export type AdminModuleKey =
  | "dashboard"
  | "users"
  | "organizations"
  | "billing"
  | "support"
  | "content"
  | "security"
  | "audit"
  | "ai"
  | "integrations"
  | "infra"
  | "config"
  | "observability"
  | "executive"
  | "roles"
  | "activity";

export interface AdminMe {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: PlatformRole;
  modules: AdminModuleKey[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ── Identity ──────────────────────────────────────────────────────────────
export const getAdminMe = () => apiRequest<AdminMe>("/admin/me");

// ── Dashboard / Executive / Observability / Activity ────────────────────────
export interface DashboardOverview {
  organizations: { total: number };
  users: { total: number; active: number; new24h: number };
  subscriptions: { active: number };
  revenue: { mrrCents: number; currency: string };
  ai: { requests24h: number; failures24h: number };
  support: { openTickets: number };
  security: { openIncidents: number };
  jobs: { running: number; failed7d: number };
  generatedAt: string;
}
export const getDashboardOverview = () =>
  apiRequest<DashboardOverview>("/admin/dashboard/overview");

export interface ExecutiveKpis {
  mrrCents: number;
  arrCents: number;
  currency: string;
  activeOrganizations: number;
  signups30d: number;
  signupsPrev30d: number;
  signupGrowthPct: number | null;
  signupTrend: { day: string; count: number }[];
}
export const getExecutiveKpis = () =>
  apiRequest<ExecutiveKpis>("/admin/executive/kpis");

export interface ObservabilitySnapshot {
  uptimeSeconds: number;
  load: { "1m": number; "5m": number; "15m": number };
  cpuCount: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    hostTotalBytes: number;
    hostFreeBytes: number;
    hostUsedPct: number;
  };
  node: string;
  generatedAt: string;
}
export const getObservability = () =>
  apiRequest<ObservabilitySnapshot>("/admin/observability/snapshot");

export interface ActivityEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  origin: string;
  organizationId: string | null;
  actorUserId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}
export const getActivity = (limit = 50) =>
  apiRequest<ActivityEvent[]>(`/admin/activity${qs({ limit })}`);

// ── Users / Roles ───────────────────────────────────────────────────────────
export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  platformRole: PlatformRole | null;
  emailVerifiedAt: string | null;
  avatarFileId: string | null;
  createdAt: string;
  updatedAt: string;
}
export const listUsers = (params: {
  search?: string;
  status?: string;
  platformRole?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<AdminUser>>(`/admin/users${qs(params)}`);

export const getUser = (userId: string) =>
  apiRequest<AdminUser & { memberships: unknown[] }>(`/admin/users/${userId}`);

export const suspendUser = (userId: string) =>
  apiRequest<AdminUser>(`/admin/users/${userId}/suspend`, { method: "POST" });
export const activateUser = (userId: string) =>
  apiRequest<AdminUser>(`/admin/users/${userId}/activate`, { method: "POST" });
export const verifyUserEmail = (userId: string) =>
  apiRequest<AdminUser>(`/admin/users/${userId}/verify-email`, {
    method: "POST",
  });

export const listStaff = () => apiRequest<AdminUser[]>("/admin/roles/staff");
export const setPlatformRole = (userId: string, platformRole: string | null) =>
  apiRequest<AdminUser>(`/admin/roles/${userId}`, {
    method: "POST",
    body: { platformRole },
  });

// ── Organizations ───────────────────────────────────────────────────────────
export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerUserId: string;
  memberCount: number;
  planTier: string;
  createdAt: string;
}
export const listOrgs = (params: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<AdminOrg>>(`/admin/organizations${qs(params)}`);
export const getOrg = (orgId: string) =>
  apiRequest<Record<string, unknown>>(`/admin/organizations/${orgId}`);
export const setOrgStatus = (orgId: string, status: string) =>
  apiRequest(`/admin/organizations/${orgId}/status`, {
    method: "POST",
    body: { status },
  });

// ── Billing ────────────────────────────────────────────────────────────────
export const listPlans = () =>
  apiRequest<Record<string, unknown>[]>("/admin/billing/plans");
export const listSubscriptions = (params: {
  status?: string;
  page?: number;
  pageSize?: number;
}) =>
  apiRequest<Paginated<Record<string, unknown>>>(
    `/admin/billing/subscriptions${qs(params)}`,
  );
export interface RevenueSummary {
  currency: string;
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  byTier: { tier: string; count: number; mrrCents: number }[];
}
export const getRevenue = () =>
  apiRequest<RevenueSummary>("/admin/billing/revenue");

// ── AI ──────────────────────────────────────────────────────────────────────
export interface AiUsage {
  windowDays: number;
  requests: number;
  failures: number;
  successRatePct: number;
  byProvider: { provider: string; count: number }[];
  byModel: { model: string; count: number }[];
}
export const getAiUsage = () => apiRequest<AiUsage>("/admin/ai/usage");
export const listAiLogs = (params: {
  status?: string;
  provider?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/ai/logs${qs(params)}`);

// ── Audit ─────────────────────────────────────────────────────────────────
export const listAudit = (params: {
  organizationId?: string;
  action?: string;
  targetType?: string;
  origin?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/audit${qs(params)}`);

// ── Integrations ────────────────────────────────────────────────────────────
export const getIntegrationProviders = () =>
  apiRequest<{ provider: string; statuses: Record<string, number>; total: number }[]>(
    "/admin/integrations/providers",
  );
export const listConnections = (params: {
  provider?: string;
  page?: number;
  pageSize?: number;
}) =>
  apiRequest<Paginated<Record<string, unknown>>>(
    `/admin/integrations/connections${qs(params)}`,
  );

// ── Infra ─────────────────────────────────────────────────────────────────
export const getQueueHealth = () =>
  apiRequest<{ queue: string; statuses: Record<string, number>; total: number }[]>(
    "/admin/infra/queues",
  );
export const listJobs = (params: {
  status?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/infra/jobs${qs(params)}`);

// ── Security ────────────────────────────────────────────────────────────────
export const getLoginEvents = (limit = 50) =>
  apiRequest<Record<string, unknown>[]>(
    `/admin/security/login-events${qs({ limit })}`,
  );
export const listIpRules = () =>
  apiRequest<Record<string, unknown>[]>("/admin/security/ip-rules");
export const createIpRule = (body: {
  cidr: string;
  kind: "allow" | "block";
  reason?: string;
}) =>
  apiRequest("/admin/security/ip-rules", { method: "POST", body });
export const deleteIpRule = (id: string) =>
  apiRequest(`/admin/security/ip-rules/${id}`, { method: "DELETE" });
export const listIncidents = (status?: string) =>
  apiRequest<Record<string, unknown>[]>(
    `/admin/security/incidents${qs({ status })}`,
  );
export const setIncidentStatus = (id: string, status: string) =>
  apiRequest(`/admin/security/incidents/${id}/status`, {
    method: "POST",
    body: { status },
  });

// ── Support ────────────────────────────────────────────────────────────────
export const listTickets = (params: {
  status?: string;
  priority?: string;
  page?: number;
  pageSize?: number;
}) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/support/tickets${qs(params)}`);
export const getSupportStats = () =>
  apiRequest<{
    open: number;
    pending: number;
    resolved: number;
    slaBreached: number;
    avgCsat: number | null;
  }>("/admin/support/stats");
export const updateTicket = (
  id: string,
  body: Record<string, unknown>,
) => apiRequest(`/admin/support/tickets/${id}`, { method: "PATCH", body });

// ── Content ────────────────────────────────────────────────────────────────
export const listAnnouncements = (params: {
  status?: string;
  channel?: string;
}) =>
  apiRequest<Record<string, unknown>[]>(`/admin/content/announcements${qs(params)}`);
export const createAnnouncement = (body: {
  title: string;
  body: string;
  channel?: string;
}) => apiRequest("/admin/content/announcements", { method: "POST", body });

// ── Config ─────────────────────────────────────────────────────────────────
export interface PlatformConfig {
  id: string;
  key: string;
  value: string | null;
  category: string;
  description: string | null;
  isSecret: boolean;
  version: number;
  updatedAt: string;
}
export const listConfig = (category?: string) =>
  apiRequest<PlatformConfig[]>(`/admin/config${qs({ category })}`);
export const upsertConfig = (body: {
  key: string;
  value: string | null;
  category?: string;
  description?: string;
  isSecret?: boolean;
}) => apiRequest<PlatformConfig>("/admin/config", { method: "POST", body });
export const rollbackConfig = (key: string) =>
  apiRequest<PlatformConfig>(`/admin/config/${encodeURIComponent(key)}/rollback`, {
    method: "POST",
  });
