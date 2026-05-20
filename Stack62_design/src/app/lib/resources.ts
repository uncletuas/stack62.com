import { apiRequest, getApiBaseUrl, getStoredToken } from './api';

export interface SystemSummary {
  id: string;
  organizationId: string;
  workspaceId: string;
  createdByUserId: string;
  name: string;
  slug: string;
  purpose: string | null;
  description: string | null;
  teamSize: number | null;
  industryType: string | null;
  governanceMode: string;
  visibility: string;
  status: string;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FieldDefinition {
  id: string;
  systemId: string;
  systemVersionId: string;
  entityDefinitionId: string;
  name: string;
  key: string;
  dataType: string;
  required: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntityDefinition {
  id: string;
  systemId: string;
  systemVersionId: string;
  moduleDefinitionId: string;
  name: string;
  key: string;
  description: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  fields: FieldDefinition[];
}

export interface ModuleDefinition {
  id: string;
  systemId: string;
  systemVersionId: string;
  name: string;
  key: string;
  kind: string;
  description: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  entities: EntityDefinition[];
  recordCount: number;
  pendingCount: number;
}

export interface WorkflowDefinition {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string;
  systemVersionId: string | null;
  moduleDefinitionId: string | null;
  createdByUserId: string;
  name: string;
  key: string;
  triggerType: string;
  definition: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunHistoryEntry {
  at: string;
  actorUserId: string;
  fromStepKey: string | null;
  toStepKey: string | null;
  action: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WorkflowRun {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string;
  workflowDefinitionId: string;
  recordId: string | null;
  startedByUserId: string;
  currentStepKey: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  context: Record<string, unknown> | null;
  history: WorkflowRunHistoryEntry[];
  nextRunAt: string | null;
  retryCount: number;
  maxRetries: number;
  escalationAt: string | null;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string;
  moduleDefinitionId: string;
  entityDefinitionId: string;
  createdByUserId: string;
  updatedByUserId: string;
  status: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRecordDetail extends RuntimeRecord {
  entityDefinition: EntityDefinition | null;
  fields: FieldDefinition[];
}

export interface Task {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string | null;
  recordId: string | null;
  createdByUserId: string;
  assigneeUserId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string | null;
  taskId: string | null;
  recordId: string | null;
  createdByUserId: string;
  title: string;
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  recurrenceRule: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  systemId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  origin: 'user' | 'ai' | 'system';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharePackage {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string;
  createdByUserId: string;
  name: string;
  mode: string;
  dataAccessMode: string;
  token: string;
  status: string;
  expiresAt: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  systemId: string | null;
  actorUserId: string | null;
  queueName: string;
  jobType: string;
  bullJobId: string | null;
  status: string;
  progress: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiPlan {
  id: string;
  requestId: string;
  planType: string;
  structuredPlan: Record<string, unknown>;
  summary: string;
  riskLevel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiValidation {
  id: string;
  requestId: string;
  planId: string;
  isValid: boolean;
  issues: string[];
  warnings: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiArtifact {
  id: string;
  requestId: string;
  planId: string;
  artifactType: string;
  fileName: string;
  filePath: string;
  contentPreview: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChangeRequest {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string | null;
  actorUserId: string;
  backgroundJobId: string | null;
  prompt: string;
  intent: string | null;
  status: string;
  riskLevel: string | null;
  autoApply: boolean;
  generateArtifacts: boolean;
  summary: string | null;
  appliedSystemId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChangeRequestDetail extends AiChangeRequest {
  plans: AiPlan[];
  validations: AiValidation[];
  artifacts: AiArtifact[];
}

export interface AiRequestCreateResult {
  request: AiChangeRequest;
  backgroundJob: BackgroundJob;
}

export interface SystemDetail extends SystemSummary {
  versions: Array<Record<string, unknown>>;
  activeVersion: Record<string, unknown> | null;
  modules: ModuleDefinition[];
  views: Array<Record<string, unknown>>;
  dashboards: Array<Record<string, unknown>>;
  workflows: WorkflowDefinition[];
  permissionPolicies: Array<Record<string, unknown>>;
  metrics: {
    totalRecords: number;
    activeRecords: number;
    pendingRecords: number;
    moduleCount: number;
    workflowCount: number;
    dashboardCount: number;
  };
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  workspaceId: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSystems(query: {
  organizationId: string;
  workspaceId?: string;
  status?: string;
}) {
  return apiRequest<SystemSummary[]>('/systems', { query });
}

export async function fetchSystem(systemId: string) {
  return apiRequest<SystemDetail>(`/systems/${systemId}`);
}

export interface WorkspaceDocument {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  systemId: string | null;
  title: string;
  content: string;
  format: string;
  currentVersion: number;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  systemId: string | null;
  title: string;
  summary: string;
  data: Record<string, unknown>;
  sourceType: 'tasks' | 'records' | 'activity' | 'mixed';
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function deleteSystem(systemId: string) {
  return apiRequest<SystemSummary>(`/systems/${systemId}`, {
    method: 'DELETE',
  });
}

export async function createSystem(payload: {
  organizationId: string;
  workspaceId: string;
  name: string;
  description?: string;
  purpose?: string;
  teamSize?: number;
  industryType?: string;
  governanceMode?: string;
  visibility?: string;
}) {
  return apiRequest<{ system: SystemSummary; version: Record<string, unknown> }>(
    '/systems',
    {
      method: 'POST',
      body: payload,
    },
  );
}

export async function fetchTasks(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  assigneeUserId?: string;
  status?: string;
}) {
  return apiRequest<Task[]>('/tasks', { query });
}

export async function updateTask(
  taskId: string,
  payload: Partial<Pick<Task, 'status' | 'priority' | 'dueAt' | 'assigneeUserId'>> & {
    metadata?: Record<string, unknown> | null;
  },
) {
  return apiRequest<Task>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function fetchRecords(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  entityDefinitionId?: string;
  moduleDefinitionId?: string;
  status?: string;
}) {
  return apiRequest<RuntimeRecord[]>('/records', { query });
}

export async function createRecord(payload: {
  organizationId: string;
  workspaceId: string;
  systemId: string;
  moduleDefinitionId: string;
  entityDefinitionId: string;
  status?: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<RuntimeRecord>('/records', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchRecord(recordId: string) {
  return apiRequest<RuntimeRecordDetail>(`/records/${recordId}`);
}

export async function updateRecord(
  recordId: string,
  payload: {
    status?: string;
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<RuntimeRecordDetail>(`/records/${recordId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function fetchActivity(query: {
  organizationId?: string;
  workspaceId?: string;
  systemId?: string;
}) {
  return apiRequest<ActivityLog[]>('/activity', { query });
}

export interface WorkspaceDashboard {
  pendingAiRequests: number;
  activeWorkflowRuns: number;
  aiHandledToday: number;
  recentActivity: ActivityLog[];
}

export async function fetchDashboard(query: {
  organizationId?: string;
  workspaceId?: string;
}) {
  return apiRequest<WorkspaceDashboard>('/activity/dashboard', { query });
}

export async function fetchDocuments(query: {
  organizationId?: string;
  workspaceId?: string;
  systemId?: string;
  status?: string;
}) {
  return apiRequest<WorkspaceDocument[]>('/documents', { query });
}

export async function fetchDocument(documentId: string) {
  return apiRequest<WorkspaceDocument>(`/documents/${documentId}`);
}

export async function createDocument(payload: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  title: string;
  content?: string;
}) {
  return apiRequest<WorkspaceDocument>('/documents', {
    method: 'POST',
    body: payload,
  });
}

export async function updateDocument(
  documentId: string,
  payload: {
    title?: string;
    content?: string;
    changeSummary?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<WorkspaceDocument>(`/documents/${documentId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function fetchReports(query: {
  organizationId?: string;
  workspaceId?: string;
  systemId?: string;
  status?: string;
}) {
  return apiRequest<Report[]>('/reports', { query });
}

export async function fetchReport(reportId: string) {
  return apiRequest<Report>(`/reports/${reportId}`);
}

export async function updateReport(
  reportId: string,
  payload: Partial<Pick<Report, 'title' | 'summary' | 'data' | 'status'>>,
) {
  return apiRequest<Report>(`/reports/${reportId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function saveReportAsDocument(reportId: string) {
  return apiRequest<WorkspaceDocument>(`/reports/${reportId}/save-document`, {
    method: 'POST',
  });
}

export async function generateReport(payload: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  title: string;
  sourceType: 'tasks' | 'records' | 'activity' | 'mixed';
  filters?: Record<string, unknown>;
}) {
  return apiRequest<Report>('/reports/generate', {
    method: 'POST',
    body: payload,
  });
}

export interface WorkspaceSearchResult {
  query: string;
  chunks: Array<{
    id: string;
    sourceType: 'document' | 'file';
    sourceId: string;
    sourceTitle: string;
    chunkIndex: number;
    content: string;
    score: number;
    metadata: Record<string, unknown> | null;
  }>;
  documents: Array<{ id: string; title: string; type: 'document'; updatedAt: string }>;
  files: Array<{ id: string; title: string; type: 'file'; updatedAt: string }>;
  records: Array<{ id: string; title: string; type: 'record'; updatedAt: string }>;
  schedules: Array<{ id: string; title: string; type: 'schedule'; updatedAt: string }>;
  systems: Array<{ id: string; title: string; type: 'system'; updatedAt: string }>;
  tasks: Array<{ id: string; title: string; type: 'task'; updatedAt: string }>;
}

export async function searchWorkspace(query: {
  organizationId: string;
  workspaceId?: string;
  q: string;
}) {
  return apiRequest<WorkspaceSearchResult>('/search/workspace', { query });
}

export async function askWorkspace(payload: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  question: string;
}) {
  return apiRequest<{
    answer: string;
    citations: Array<{
      index: number;
      sourceType: 'document' | 'file';
      sourceId: string;
      sourceTitle: string;
      chunkIndex: number;
      excerpt: string;
      score: number;
    }>;
  }>('/search/workspace/ask', {
    method: 'POST',
    body: payload,
  });
}

export interface AuditLog {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  systemId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  origin: 'user' | 'ai' | 'system';
  beforeData: unknown | null;
  afterData: unknown | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAuditLogs(query: {
  organizationId?: string;
  workspaceId?: string;
  systemId?: string;
  action?: string;
  targetType?: string;
}) {
  return apiRequest<AuditLog[]>('/audit', { query });
}

export async function fetchSchedules(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  status?: string;
}) {
  return apiRequest<Schedule[]>('/schedule', { query });
}

export async function deleteSchedule(scheduleId: string) {
  return apiRequest<Schedule>(`/schedule/${scheduleId}`, {
    method: 'DELETE',
  });
}

export async function fetchWorkflows(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
}) {
  return apiRequest<WorkflowDefinition[]>('/workflows/definitions', { query });
}

export async function createWorkflow(payload: {
  organizationId: string;
  workspaceId: string;
  systemId: string;
  systemVersionId?: string;
  moduleDefinitionId?: string;
  name: string;
  key?: string;
  triggerType: string;
  definition: Record<string, unknown>;
}) {
  return apiRequest<WorkflowDefinition>('/workflows/definitions', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchSharePackages(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  mode?: string;
}) {
  return apiRequest<SharePackage[]>('/sharing/packages', { query });
}

export async function createSharePackage(payload: {
  organizationId: string;
  workspaceId: string;
  systemId: string;
  name: string;
  mode: 'template_only' | 'cloned_instance' | 'live_shared_workspace';
  dataAccessMode: 'include_data' | 'masked_data' | 'exclude_data';
  expiresAt?: string;
  config?: Record<string, unknown>;
}) {
  return apiRequest<SharePackage>('/sharing/packages', {
    method: 'POST',
    body: payload,
  });
}

export async function fetchAiRequests(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  status?: string;
}) {
  return apiRequest<AiChangeRequest[]>('/ai/requests', { query });
}

export async function fetchAiRequest(requestId: string) {
  return apiRequest<AiChangeRequestDetail>(`/ai/requests/${requestId}`);
}

export async function createAiRequest(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  prompt: string;
  model?: string;
  autoApply?: boolean;
  generateArtifacts?: boolean;
  context?: Record<string, unknown>;
}) {
  return apiRequest<AiRequestCreateResult>('/ai/requests', {
    method: 'POST',
    body: payload,
  });
}

export async function applyAiRequest(requestId: string) {
  return apiRequest<Record<string, unknown>>(`/ai/requests/${requestId}/apply`, {
    method: 'POST',
  });
}

export type DiffOp = 'add' | 'remove' | 'modify';

export interface DiffItemBase {
  id: string;
  op: DiffOp;
  riskScore: number;
  reasons: string[];
}

export interface ModuleDiffItem extends DiffItemBase {
  kind: 'module';
  moduleKey: string;
  before?: { name: string; key: string; description?: string | null };
  after?: { name: string; key: string; description?: string | null };
}

export interface EntityDiffItem extends DiffItemBase {
  kind: 'entity';
  moduleKey: string;
  entityKey: string;
  before?: { name: string; key: string; description?: string | null };
  after?: { name: string; key: string; description?: string | null };
}

export interface FieldDiffItem extends DiffItemBase {
  kind: 'field';
  moduleKey: string;
  entityKey: string;
  fieldKey: string;
  before?: { name: string; key: string; dataType: string; required: boolean };
  after?: { name: string; key: string; dataType: string; required: boolean };
}

export interface WorkflowDiffItem extends DiffItemBase {
  kind: 'workflow';
  key: string;
  before?: { name: string; key?: string | null; triggerType: string };
  after?: { name: string; key?: string | null; triggerType: string };
}

export interface PermissionDiffItem extends DiffItemBase {
  kind: 'permission';
  identity: string;
  before?: { name: string; role: string; scope: string };
  after?: { name: string; role: string; scope: string };
}

export interface AiRequestDiff {
  requestId: string;
  planId: string;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff: {
    modules: ModuleDiffItem[];
    entities: EntityDiffItem[];
    fields: FieldDiffItem[];
    workflows: WorkflowDiffItem[];
    permissions: PermissionDiffItem[];
    riskScore: number;
    riskLevel: 'low' | 'medium' | 'high';
    summary: {
      modulesAdded: number;
      modulesRemoved: number;
      entitiesAdded: number;
      entitiesRemoved: number;
      fieldsAdded: number;
      fieldsRemoved: number;
      fieldsModified: number;
    };
  };
}

export interface AiRequestImpactItem {
  changeId: string;
  recordsAffected: number;
  workflowsAffected: number;
  notes: string[];
}

export interface AiRequestImpact {
  requestId: string;
  impact: {
    totals: {
      recordsAffected: number;
      workflowsAffected: number;
      destructiveChanges: number;
    };
    items: Record<string, AiRequestImpactItem>;
  };
}

export async function fetchAiRequestDiff(requestId: string) {
  return apiRequest<AiRequestDiff>(`/ai/requests/${requestId}/diff`);
}

export async function fetchAiRequestImpact(requestId: string) {
  return apiRequest<AiRequestImpact>(`/ai/requests/${requestId}/impact`);
}

export async function applyAiRequestSelection(
  requestId: string,
  changeIds: string[],
) {
  return apiRequest<Record<string, unknown>>(
    `/ai/requests/${requestId}/apply`,
    {
      method: 'POST',
      body: { selection: { changeIds } },
    },
  );
}

export async function rejectAiRequest(requestId: string, reason?: string) {
  return apiRequest<AiChangeRequest>(`/ai/requests/${requestId}/reject`, {
    method: 'POST',
    body: { reason },
  });
}

export async function cancelBackgroundJob(jobId: string) {
  return apiRequest<BackgroundJob>(`/jobs/${jobId}/cancel`, {
    method: 'POST',
  });
}

export async function rollbackSystemVersion(
  systemId: string,
  versionId: string,
  reason?: string,
) {
  return apiRequest<{ system: SystemSummary; version: Record<string, unknown> }>(
    `/systems/${systemId}/versions/${versionId}/rollback`,
    {
      method: 'POST',
      body: { reason },
    },
  );
}

export async function fetchJob(jobId: string) {
  return apiRequest<BackgroundJob>(`/jobs/${jobId}`);
}

export async function fetchUsers() {
  return apiRequest<UserSummary[]>('/users');
}

export async function fetchMemberships(query: {
  organizationId?: string;
  workspaceId?: string;
}) {
  return apiRequest<Membership[]>('/memberships', { query });
}

export async function fetchOrganizations() {
  return apiRequest<
    Array<{
      id: string;
      name: string;
      slug: string;
      description?: string | null;
      status: string;
      ownerUserId: string;
      openrouterApiKey?: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  >('/organizations');
}

export async function updateOrgSettings(
  orgId: string,
  payload: { openrouterApiKey?: string | null; preferredModel?: string | null },
) {
  return apiRequest<{
    id: string;
    name: string;
    slug: string;
    openrouterApiKey?: string | null;
  }>(`/organizations/${orgId}/settings`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function fetchWorkspaces(query: { organizationId?: string }) {
  return apiRequest<
    Array<{
      id: string;
      organizationId: string;
      name: string;
      slug: string;
      description?: string | null;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>
  >('/workspaces', { query });
}

export async function createMembership(payload: {
  userId: string;
  organizationId: string;
  workspaceId?: string;
  role: string;
}) {
  return apiRequest<Membership>('/memberships', {
    method: 'POST',
    body: payload,
  });
}

export async function createTask(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  recordId?: string;
  assigneeUserId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<Task>('/tasks', {
    method: 'POST',
    body: payload,
  });
}

// ---------- Memberships / Invites (new actions) ----------

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  organizationId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export function inviteMember(payload: {
  organizationId: string;
  workspaceId?: string;
  email: string;
  role?: string;
}) {
  return apiRequest<{ membership: Membership | null; invite: OrgInvite | null }>('/memberships/invite', {
    method: 'POST',
    body: payload,
  });
}

export function removeMember(membershipId: string) {
  return apiRequest<Membership>(`/memberships/${membershipId}`, { method: 'DELETE' });
}

export function updateMember(membershipId: string, payload: { role?: string; status?: string }) {
  return apiRequest<Membership>(`/memberships/${membershipId}`, { method: 'PATCH', body: payload });
}

export function fetchPendingInvites(organizationId: string) {
  return apiRequest<OrgInvite[]>(`/memberships/invites?organizationId=${organizationId}`);
}

// ---------- Files ----------

export type FileScope =
  | 'attachment'
  | 'document'
  | 'system_asset'
  | 'avatar'
  | 'other';

export interface StoredFile {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  systemId: string | null;
  scope: FileScope;
  filename: string;
  mimeType: string;
  size: string;
  storagePath: string;
  checksum: string | null;
  ownerKind: string | null;
  ownerId: string | null;
  metadata: Record<string, unknown> | null;
  uploadedByUserId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function uploadFile(params: {
  file: File;
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  scope?: FileScope;
  ownerKind?: string;
  ownerId?: string;
}) {
  const form = new FormData();
  form.append('file', params.file);
  form.append('organizationId', params.organizationId);
  if (params.workspaceId) form.append('workspaceId', params.workspaceId);
  if (params.systemId) form.append('systemId', params.systemId);
  if (params.scope) form.append('scope', params.scope);
  if (params.ownerKind) form.append('ownerKind', params.ownerKind);
  if (params.ownerId) form.append('ownerId', params.ownerId);
  return apiRequest<StoredFile>('/files/upload', {
    method: 'POST',
    body: form,
  });
}

export async function listFiles(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  scope?: FileScope;
  ownerKind?: string;
  ownerId?: string;
}) {
  return apiRequest<StoredFile[]>('/files', { query });
}

export async function deleteFile(fileId: string) {
  return apiRequest<{ id: string; status: string }>(`/files/${fileId}`, {
    method: 'DELETE',
  });
}

// ── Workspace state (AI-native docs/sheets/slides) ────────────────

export type WorkspaceDocKind = 'document' | 'sheet' | 'slides';

export interface WorkspaceDocSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdByUserId: string;
  kind: WorkspaceDocKind;
  title: string;
  currentVersion: number;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchWorkspaceDocs(query: {
  organizationId: string;
  workspaceId?: string;
  kind?: WorkspaceDocKind;
}) {
  return apiRequest<WorkspaceDocSummary[]>('/workspace/docs', { query });
}

export async function fetchWorkspaceDoc(docId: string) {
  return apiRequest<WorkspaceDocSummary>(`/workspace/docs/${docId}`);
}

export async function fetchWorkspaceDocState(docId: string) {
  return apiRequest<{
    id: string;
    kind: WorkspaceDocKind;
    title: string;
    currentVersion: number;
    state: unknown;
  }>(`/workspace/docs/${docId}/state`);
}

export interface WorkspaceActionLogEntry {
  id: string;
  docId: string;
  actorKind: 'user' | 'coworker';
  actorUserId: string;
  coworkerId: string | null;
  verb: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export async function fetchWorkspaceActionLog(docId: string, limit = 50) {
  return apiRequest<WorkspaceActionLogEntry[]>(
    `/workspace/docs/${docId}/actions`,
    { query: { limit: String(limit) } },
  );
}

/**
 * Create a new workspace doc by dispatching the `workspace.create_doc`
 * action. The placeholder docId in the URL is ignored by the
 * service when the verb is create_doc — a fresh doc is minted.
 */
export async function createWorkspaceDoc(payload: {
  organizationId: string;
  workspaceId: string;
  kind: WorkspaceDocKind;
  title: string;
  initial?: unknown;
}) {
  return apiRequest<{ action: { docId: string }; version: number }>(
    `/workspace/docs/00000000-0000-0000-0000-000000000000/actions`,
    {
      method: 'POST',
      body: {
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        action: {
          verb: 'workspace.create_doc',
          kind: payload.kind,
          title: payload.title,
          initial: payload.initial,
        },
      },
    },
  );
}

export async function dispatchWorkspaceAction(payload: {
  organizationId: string;
  workspaceId?: string;
  docId: string;
  action: Record<string, unknown>;
}) {
  return apiRequest<{
    action: { id: string; docId: string };
    version: number;
  }>(`/workspace/docs/${payload.docId}/actions`, {
    method: 'POST',
    body: {
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      action: payload.action,
    },
  });
}

/**
 * Build the wss:// URL for the Hocuspocus realtime endpoint. Derives
 * scheme + host from the configured API base — wss if the API is
 * https, ws otherwise.
 */
export function getWorkspaceRealtimeUrl(): string {
  const base = getApiBaseUrl();
  try {
    const u = new URL(base);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    // base already includes the /v1 prefix.
    return `${wsProto}//${u.host}${u.pathname.replace(/\/$/, '')}/realtime/workspace`;
  } catch {
    return base.replace(/^http/, 'ws') + '/realtime/workspace';
  }
}

export async function updateFile(
  fileId: string,
  patch: { filename?: string; folderId?: string | null },
) {
  return apiRequest<{ id: string; filename: string; folderId: string | null }>(
    `/files/${fileId}`,
    { method: 'PATCH', body: patch },
  );
}

export async function copyFile(
  fileId: string,
  opts: { folderId?: string | null; filename?: string } = {},
) {
  return apiRequest<{ id: string; filename: string; folderId: string | null }>(
    `/files/${fileId}/copy`,
    { method: 'POST', body: opts },
  );
}

export async function bulkDeleteFiles(ids: string[]) {
  return apiRequest<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
    `/files/bulk-delete`,
    { method: 'POST', body: { ids } },
  );
}

export async function bulkMoveFiles(ids: string[], folderId: string | null) {
  return apiRequest<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
    `/files/bulk-move`,
    { method: 'POST', body: { ids, folderId } },
  );
}

export interface EditableFileContent {
  fileId: string;
  filename: string;
  mimeType: string;
  editable: boolean;
  format: 'text' | 'docx' | 'xlsx' | 'pptx';
  text: string;
}

export function fetchFileContent(fileId: string) {
  return apiRequest<EditableFileContent>(`/files/${fileId}/content`);
}

export function saveFileContent(fileId: string, text: string) {
  return apiRequest<EditableFileContent>(`/files/${fileId}/content`, {
    method: 'PATCH',
    body: { text },
  });
}

export function fileDownloadUrl(fileId: string) {
  return `${getApiBaseUrl()}/files/${fileId}/download`;
}

/**
 * Returns an authenticated blob URL for inline preview (images etc).
 * Caller is responsible for URL.revokeObjectURL when done.
 */
export async function fetchFileBlobUrl(fileId: string): Promise<string> {
  const token = getStoredToken();
  const res = await fetch(`${getApiBaseUrl()}/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---------- Runner ----------

export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'crashed';

export interface SystemDeployment {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  systemId: string;
  runtime: string;
  entrypoint: string;
  sourceDir: string;
  logPath: string | null;
  port: number | null;
  pid: number | null;
  status: DeploymentStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSystemSummary {
  systemId: string;
  dir: string;
  summary: string;
  entrypoint: string;
  runtime: string;
  fileCount: number;
  files: Array<{ path: string; size: number }>;
}

export function generateSystemCode(payload: {
  systemId: string;
  organizationId: string;
  workspaceId?: string;
  prompt: string;
  model?: string;
}) {
  return apiRequest<GeneratedSystemSummary>('/runner/generate', {
    method: 'POST',
    body: payload,
  });
}

export function deploySystem(payload: {
  systemId: string;
  organizationId: string;
  workspaceId?: string;
  entrypoint?: string;
  runtime?: string;
}) {
  return apiRequest<SystemDeployment>('/runner/deploy', {
    method: 'POST',
    body: payload,
  });
}

export function fetchDeployment(deploymentId: string) {
  return apiRequest<SystemDeployment>(`/runner/deployments/${deploymentId}`);
}

export function fetchDeployments(
  input:
    | string
    | {
        systemId?: string;
        organizationId?: string;
        workspaceId?: string;
        status?: DeploymentStatus;
      },
) {
  const query = typeof input === "string" ? { systemId: input } : input;
  return apiRequest<SystemDeployment[]>('/runner/deployments', {
    query,
  });
}

export function startDeployment(deploymentId: string) {
  return apiRequest<SystemDeployment>(`/runner/deployments/${deploymentId}/start`, {
    method: 'POST',
  });
}

export function stopDeployment(deploymentId: string) {
  return apiRequest<SystemDeployment>(`/runner/deployments/${deploymentId}/stop`, {
    method: 'POST',
  });
}

export function fetchDeploymentLogs(deploymentId: string, tail = 200) {
  return apiRequest<{ lines: string[] }>(
    `/runner/deployments/${deploymentId}/logs`,
    { query: { tail } },
  );
}

export type RunnerEventLevel = 'info' | 'done' | 'error' | 'log';
export type RunnerEventPhase =
  | 'generation'
  | 'file'
  | 'install'
  | 'runtime'
  | 'deployment'
  | 'status';

export interface RunnerEvent {
  id: string;
  systemId: string;
  deploymentId?: string;
  phase: RunnerEventPhase;
  level: RunnerEventLevel;
  message: string;
  detail?: string;
  timestamp: string;
}

export function createRunnerEventSource(systemId: string) {
  const token = getStoredToken();
  const url = new URL(`${getApiBaseUrl()}/runner/systems/${systemId}/events`);
  if (token) url.searchParams.set('token', token);
  return new EventSource(url.toString());
}

// ---------- AI providers ----------

export interface AiProvidersStatus {
  openrouter: { available: boolean; defaultModel: string };
  claudeCode: {
    available: boolean;
    version: string | null;
    hint: string | null;
    models: string[];
  };
}

export function fetchAiProviders() {
  return apiRequest<AiProvidersStatus>('/ai/providers');
}

export function chatWithAi(payload: {
  organizationId: string;
  workspaceId?: string;
  prompt: string;
  model?: string;
  context?: Record<string, unknown>;
}) {
  return apiRequest<{ answer: string }>('/ai/chat', {
    method: 'POST',
    body: payload,
  });
}

// ---------- Engine ----------

export interface EngineToolMeta {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export type EngineEvent =
  | { type: 'session.started'; sessionId: string; model: string }
  | { type: 'message.delta'; text: string }
  | { type: 'message.complete'; text: string }
  | {
      type: 'tool.call';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool.result';
      id: string;
      name: string;
      ok: boolean;
      summary?: string;
      output: unknown;
    }
  | { type: 'session.complete'; turns: number; stopReason: string }
  | { type: 'session.error'; message: string };

export interface EngineRunPayload {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  prompt: string;
  systemHint?: string;
  model?: string;
  autopilot?: boolean;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function fetchEngineTools() {
  return apiRequest<EngineToolMeta[]>('/engine/tools');
}

// ---------- Coworker ----------

export interface CoworkerPermissions {
  canSendEmail: boolean;
  canSendMessage: boolean;
  canApplyPlans: boolean;
  canCreateRecords: boolean;
  canRunJobs: boolean;
  canSendPayments: boolean;
}

export type CoworkerRole =
  | 'admin'
  | 'manager'
  | 'staff'
  | 'reviewer'
  | 'read_only';

export const COWORKER_ROLES: CoworkerRole[] = [
  'admin',
  'manager',
  'staff',
  'reviewer',
  'read_only',
];

export interface Coworker {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  model: string | null;
  voice: string | null;
  defaultAutopilot: boolean;
  /** Coworker acts on its own queue without per-action approval. */
  autonomousMode: boolean;
  /** Max action-level the Coworker may execute autonomously (1..5). */
  autonomousMaxActionLevel: number;
  permissions: CoworkerPermissions;
  role: CoworkerRole;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export type JobTriggerType = 'manual' | 'schedule' | 'event';

export interface JobTriggerConfig {
  runAt?: string | null;
  rrule?: string | null;
  eventName?: string | null;
}

export interface CoworkerJob {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string | null;
  createdByUserId: string;
  title: string;
  instructions: string;
  status: JobStatus;
  triggerType: JobTriggerType;
  triggerConfig: JobTriggerConfig | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  autopilot: boolean;
  runCount: number;
  pausedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoworkerJobRun {
  id: string;
  jobId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  triggeredBy: 'manual' | 'schedule' | 'event';
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<Record<string, unknown>>;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function fetchCoworker(organizationId: string, workspaceId: string) {
  return apiRequest<Coworker>('/coworker', {
    query: { organizationId, workspaceId },
  });
}

export function updateCoworker(payload: {
  organizationId: string;
  workspaceId: string;
  name?: string;
  description?: string | null;
  model?: string | null;
  voice?: string | null;
  defaultAutopilot?: boolean;
  permissions?: Partial<CoworkerPermissions>;
  role?: CoworkerRole;
}) {
  return apiRequest<Coworker>('/coworker', { method: 'PATCH', body: payload });
}

export function fetchJobs(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  status?: JobStatus;
}) {
  return apiRequest<CoworkerJob[]>('/coworker/jobs', { query });
}

export function fetchCoworkerJob(jobId: string) {
  return apiRequest<CoworkerJob>(`/coworker/jobs/${jobId}`);
}

export interface CoworkerMessage {
  id: string;
  organizationId: string;
  workspaceId: string;
  conversationId: string;
  actorUserId: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: Array<Record<string, unknown>> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchCoworkerMessages(query: {
  organizationId: string;
  workspaceId: string;
  conversationId?: string;
}) {
  return apiRequest<CoworkerMessage[]>('/coworker/messages', { query });
}

export interface CoworkerConversation {
  conversationId: string;
  messageCount: number;
  lastAt: string;
  title: string;
}

export function fetchCoworkerConversations(query: {
  organizationId: string;
  workspaceId: string;
}) {
  return apiRequest<CoworkerConversation[]>('/coworker/conversations', {
    query,
  });
}

export function coworkerChat(payload: {
  organizationId: string;
  workspaceId: string;
  conversationId?: string;
  prompt: string;
  systemId?: string;
  systemHint?: string;
  model?: string;
  autopilot?: boolean;
}) {
  return apiRequest<{
    conversationId: string;
    message: CoworkerMessage;
    toolCalls: Array<Record<string, unknown>>;
  }>('/coworker/chat', { method: 'POST', body: payload });
}

export function createJob(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  title: string;
  instructions: string;
  triggerType?: JobTriggerType;
  triggerConfig?: JobTriggerConfig;
  autopilot?: boolean;
}) {
  return apiRequest<CoworkerJob>('/coworker/jobs', {
    method: 'POST',
    body: payload,
  });
}

export function createWeeklyReportJob(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  title?: string;
  sourceType?: 'tasks' | 'records' | 'activity' | 'mixed';
  dayOfWeek?: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
  hour?: number;
  minute?: number;
}) {
  return apiRequest<CoworkerJob>('/coworker/jobs/weekly-report', {
    method: 'POST',
    body: payload,
  });
}

export function createReminderJob(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  title: string;
  instructions: string;
  runAt?: string;
  rrule?: string;
}) {
  return apiRequest<CoworkerJob>('/coworker/jobs/reminder', {
    method: 'POST',
    body: payload,
  });
}

export function updateJob(
  jobId: string,
  payload: Partial<{
    title: string;
    instructions: string;
    triggerType: JobTriggerType;
    triggerConfig: JobTriggerConfig;
    autopilot: boolean;
    status: JobStatus;
  }>,
) {
  return apiRequest<CoworkerJob>(`/coworker/jobs/${jobId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function runJob(jobId: string) {
  return apiRequest<{ ok: boolean }>(`/coworker/jobs/${jobId}/run`, {
    method: 'POST',
  });
}

export function pauseJob(jobId: string) {
  return apiRequest<CoworkerJob>(`/coworker/jobs/${jobId}/pause`, {
    method: 'POST',
  });
}

export function resumeJob(jobId: string) {
  return apiRequest<CoworkerJob>(`/coworker/jobs/${jobId}/resume`, {
    method: 'POST',
  });
}

export function cancelJob(jobId: string) {
  return apiRequest<CoworkerJob>(`/coworker/jobs/${jobId}`, {
    method: 'DELETE',
  });
}

export function fetchJobRuns(jobId: string) {
  return apiRequest<CoworkerJobRun[]>(`/coworker/jobs/${jobId}/runs`);
}

export type CoworkerMemoryKind = 'fact' | 'preference' | 'episode';
export type CoworkerMemorySource = 'user' | 'coworker';

export interface CoworkerMemory {
  id: string;
  organizationId: string;
  workspaceId: string;
  systemId: string | null;
  kind: CoworkerMemoryKind;
  key: string | null;
  text: string;
  source: CoworkerMemorySource;
  createdByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchCoworkerMemories(query: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  kind?: CoworkerMemoryKind;
}) {
  return apiRequest<CoworkerMemory[]>('/coworker/memories', { query });
}

export function createCoworkerMemory(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  kind?: CoworkerMemoryKind;
  key?: string;
  text: string;
  source?: CoworkerMemorySource;
}) {
  return apiRequest<CoworkerMemory>('/coworker/memories', {
    method: 'POST',
    body: payload,
  });
}

export function updateCoworkerMemory(
  memoryId: string,
  payload: { kind?: CoworkerMemoryKind; key?: string | null; text?: string },
) {
  return apiRequest<CoworkerMemory>(`/coworker/memories/${memoryId}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function deleteCoworkerMemory(memoryId: string) {
  return apiRequest<{ id: string }>(`/coworker/memories/${memoryId}`, {
    method: 'DELETE',
  });
}

/**
 * Streams engine events via SSE-over-fetch. Calls onEvent for every event,
 * resolves when the stream ends, rejects on transport error or abort.
 */
export async function streamEngine(
  payload: EngineRunPayload,
  onEvent: (event: EngineEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getStoredToken();
  const response = await fetch(`${getApiBaseUrl()}/engine/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Engine request failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf('\n\n');
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        const event = JSON.parse(json) as EngineEvent;
        onEvent(event);
      } catch {
        /* ignore malformed */
      }
    }
  }
}

export async function fetchWorkflowRuns(query: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  workflowDefinitionId?: string;
  recordId?: string;
  status?: string;
}) {
  return apiRequest<WorkflowRun[]>('/workflows/runs', { query });
}

export async function startWorkflowRun(payload: {
  organizationId: string;
  workspaceId: string;
  systemId: string;
  workflowDefinitionId: string;
  recordId?: string;
  context?: Record<string, unknown>;
}) {
  return apiRequest<WorkflowRun>('/workflows/runs', {
    method: 'POST',
    body: payload,
  });
}

export async function advanceWorkflowRun(
  runId: string,
  payload: {
    action: 'advance' | 'approve' | 'reject' | 'complete' | 'cancel' | 'fail';
    nextStepKey?: string;
    note?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<WorkflowRun>(`/workflows/runs/${runId}/advance`, {
    method: 'POST',
    body: payload,
  });
}

export interface IntegrationProvider {
  key: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  credentialFields: string[];
  configFields: string[];
}

export interface IntegrationConnection {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdByUserId: string;
  providerKey: string;
  name: string;
  config: Record<string, unknown> | null;
  credentials: Record<string, unknown> | null;
  status: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchIntegrationMarketplace() {
  return apiRequest<IntegrationProvider[]>('/integrations/marketplace');
}

export interface IntegrationProviderStatus {
  providerKey: string;
  configured: boolean;
  missing: string[];
}

// ── User profile / avatar ─────────────────────────────────────────

export interface UserProfileDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  avatarFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchCurrentUser() {
  return apiRequest<UserProfileDto>('/users/me');
}

export async function updateCurrentUserProfile(patch: {
  firstName?: string;
  lastName?: string;
}) {
  return apiRequest<UserProfileDto>('/users/me', {
    method: 'PATCH',
    body: patch,
  });
}

export async function uploadCurrentUserAvatar(
  file: File,
  organizationId: string,
) {
  const form = new FormData();
  form.append('file', file);
  form.append('organizationId', organizationId);
  return apiRequest<UserProfileDto>('/users/me/avatar', {
    method: 'POST',
    body: form,
  });
}

export async function clearCurrentUserAvatar() {
  return apiRequest<UserProfileDto>('/users/me/avatar', {
    method: 'DELETE',
  });
}

export async function changeCurrentUserPassword(payload: {
  currentPassword: string;
  newPassword: string;
}) {
  return apiRequest<{ ok: boolean }>('/account/change-password', {
    method: 'POST',
    body: payload,
  });
}

export async function resendCurrentUserVerification() {
  return apiRequest<{ ok: boolean; alreadyVerified?: boolean }>(
    '/account/resend-verification',
    { method: 'POST' },
  );
}

/**
 * URL for rendering a user's avatar in <img src>. Append a cache-
 * busting param after upload so the browser doesn't keep the old
 * image from its disk cache.
 */
export function userAvatarUrl(userId: string, version?: string) {
  const base = `${getApiBaseUrl()}/users/${userId}/avatar`;
  return version ? `${base}?v=${encodeURIComponent(version)}` : base;
}

export function fetchIntegrationProvidersStatus() {
  return apiRequest<IntegrationProviderStatus[]>(
    '/integrations/providers/status',
  );
}

export function fetchIntegrationConnections(query: {
  organizationId?: string;
  workspaceId?: string;
  providerKey?: string;
}) {
  return apiRequest<IntegrationConnection[]>('/integrations/connections', {
    query,
  });
}

export function createIntegrationConnection(payload: {
  organizationId: string;
  workspaceId?: string;
  providerKey: string;
  name: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}) {
  return apiRequest<IntegrationConnection>('/integrations/connections', {
    method: 'POST',
    body: payload,
  });
}

export function verifyIntegrationConnection(connectionId: string) {
  return apiRequest<{ ok: boolean; message: string }>(
    `/integrations/connections/${connectionId}/verify`,
    { method: 'POST' },
  );
}

export function disconnectIntegrationConnection(connectionId: string) {
  return apiRequest<IntegrationConnection>(`/integrations/connections/${connectionId}`, {
    method: 'DELETE',
  });
}

export function sendIntegrationEmail(payload: {
  organizationId: string;
  workspaceId?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{ provider: string; id: string | null; ok: boolean }>(
    '/integrations/email/send',
    { method: 'POST', body: payload },
  );
}

export function sendIntegrationWhatsApp(payload: {
  organizationId: string;
  workspaceId?: string;
  to: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{ provider: string; id: string | null; ok: boolean }>(
    '/integrations/whatsapp/send',
    { method: 'POST', body: payload },
  );
}

export function googleOAuthUrl(payload: {
  organizationId: string;
  workspaceId?: string;
  redirectUri?: string;
}) {
  return apiRequest<{ url: string; state: string }>('/integrations/google/oauth/url', {
    method: 'POST',
    body: payload,
  });
}

export function completeGoogleOAuth(payload: {
  code: string;
  state: string;
  redirectUri?: string;
}) {
  return apiRequest<IntegrationConnection>('/integrations/google/oauth/callback', {
    method: 'POST',
    body: payload,
  });
}

export function metaOAuthUrl(payload: {
  organizationId: string;
  workspaceId?: string;
  redirectUri?: string;
}) {
  return apiRequest<{ url: string; state: string }>('/integrations/meta/oauth/url', {
    method: 'POST',
    body: payload,
  });
}

export function completeMetaOAuth(payload: {
  code: string;
  state: string;
  redirectUri?: string;
}) {
  return apiRequest<IntegrationConnection>('/integrations/meta/oauth/callback', {
    method: 'POST',
    body: payload,
  });
}

export function quickBooksOAuthUrl(payload: {
  organizationId: string;
  workspaceId?: string;
  redirectUri?: string;
}) {
  return apiRequest<{ url: string; state: string }>('/integrations/quickbooks/oauth/url', {
    method: 'POST',
    body: payload,
  });
}

export function completeQuickBooksOAuth(payload: {
  code: string;
  state: string;
  realmId?: string;
  redirectUri?: string;
}) {
  return apiRequest<IntegrationConnection>('/integrations/quickbooks/oauth/callback', {
    method: 'POST',
    body: payload,
  });
}

export function searchGmail(payload: {
  organizationId: string;
  workspaceId?: string;
  q: string;
}) {
  return apiRequest<{
    messages?: Array<{ id: string; threadId: string }>;
  }>('/integrations/google/gmail/search', {
    method: 'POST',
    body: payload,
  });
}

export function draftGmail(payload: {
  organizationId: string;
  workspaceId?: string;
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
}) {
  return apiRequest<{ provider: string; id: string | null; ok: boolean }>(
    '/integrations/google/gmail/draft',
    { method: 'POST', body: payload },
  );
}

export function sendGmail(payload: {
  organizationId: string;
  workspaceId?: string;
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
  confirmed: boolean;
}) {
  return apiRequest<{ provider: string; id: string | null; ok: boolean }>(
    '/integrations/google/gmail/send',
    { method: 'POST', body: payload },
  );
}

export function createGoogleCalendarEvent(payload: {
  organizationId: string;
  workspaceId?: string;
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  createMeetLink?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{
    provider: string;
    id: string | null;
    htmlLink: string | null;
    meetLink: string | null;
    ok: boolean;
  }>('/integrations/google/calendar/events', {
    method: 'POST',
    body: payload,
  });
}

export function openInGoogleWorkspace(payload: {
  organizationId: string;
  workspaceId?: string;
  title: string;
  content: string;
  kind: 'document' | 'spreadsheet' | 'presentation' | 'text';
  sourceId?: string;
  sourceType?: 'document' | 'file';
}) {
  return apiRequest<{
    provider: string;
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    ok: boolean;
  }>('/integrations/google/drive/open', {
    method: 'POST',
    body: payload,
  });
}

export function draftWhatsAppReply(payload: {
  organizationId: string;
  workspaceId?: string;
  from: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  return apiRequest<{
    provider: string;
    to: string;
    draft: string;
    requiresConfirmation: boolean;
  }>('/integrations/whatsapp/draft-reply', {
    method: 'POST',
    body: payload,
  });
}

export interface WhatsAppPhoneNumberOption {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  businessId: string;
  businessName: string;
  businessAccountId: string;
  businessAccountName: string;
}

export function fetchWhatsAppPhoneNumbers(connectionId: string) {
  return apiRequest<{
    connectionId: string;
    phoneNumbers: WhatsAppPhoneNumberOption[];
  }>(`/integrations/connections/${connectionId}/whatsapp-phone-numbers`);
}

export function selectWhatsAppPhoneNumber(
  connectionId: string,
  payload: {
    phoneNumberId: string;
    displayPhoneNumber?: string;
    verifiedName?: string | null;
    businessAccountId?: string;
  },
) {
  return apiRequest<IntegrationConnection>(
    `/integrations/connections/${connectionId}/whatsapp-phone-number`,
    {
      method: 'POST',
      body: payload,
    },
  );
}

export function initializePaystackPayment(payload: {
  organizationId: string;
  workspaceId?: string;
  email: string;
  amountKobo: number;
  reference?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<{
    provider: string;
    ok: boolean;
    message: string;
    authorizationUrl: string | null;
    accessCode: string | null;
    reference: string | null;
  }>('/integrations/payments/paystack/initialize', {
    method: 'POST',
    body: payload,
  });
}

export function verifyPaystackPayment(payload: {
  organizationId: string;
  workspaceId?: string;
  reference: string;
}) {
  return apiRequest<{
    provider: string;
    ok: boolean;
    message: string | null;
    paymentStatus: string | null;
    amountKobo: number | null;
    reference: string;
  }>('/integrations/payments/paystack/verify', {
    method: 'POST',
    body: payload,
  });
}

export function auditExportCsvUrl(query: {
  organizationId?: string;
  workspaceId?: string;
  systemId?: string;
  action?: string;
  targetType?: string;
}) {
  const url = new URL(`${getApiBaseUrl()}/audit/export.csv`);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export interface DeploymentPreviewSession {
  token: string;
  deploymentId: string;
  proxyPath: string;
  expiresInSeconds: number;
}

/**
 * Mint a short-lived token for the /sys/:id reverse proxy so the iframe
 * can open the running system without shipping the user's main access token.
 */
export function createPreviewSession(deploymentId: string) {
  return apiRequest<DeploymentPreviewSession>(
    `/runner/deployments/${deploymentId}/preview-session`,
    { method: 'POST' },
  );
}

/**
 * Absolute URL for the /sys/:id proxy (outside the /v1 API prefix).
 * Appends ?_t=<previewToken> so the proxy can authorise the first request
 * and set a per-deployment cookie for subsequent asset fetches.
 */
export function buildPreviewUrl(session: DeploymentPreviewSession, subpath = '') {
  const base = getApiBaseUrl().replace(/\/v1\/?$/, '');
  const clean = subpath.startsWith('/') ? subpath.slice(1) : subpath;
  const path = clean
    ? `${session.proxyPath.replace(/\/$/, '')}/${clean}`
    : session.proxyPath;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${path}${sep}_t=${encodeURIComponent(session.token)}`;
}

// ---------- Runner: source file tree + editor ----------

export interface DeploymentFileNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size?: number;
  children?: DeploymentFileNode[];
}

export interface DeploymentFileContent {
  path: string;
  size: number;
  editable: boolean;
  content: string | null;
  updatedAt: string;
}

export function fetchDeploymentFiles(deploymentId: string) {
  return apiRequest<{ tree: DeploymentFileNode[] }>(
    `/runner/deployments/${deploymentId}/files`,
  );
}

export function fetchDeploymentFileContent(deploymentId: string, path: string) {
  return apiRequest<DeploymentFileContent>(
    `/runner/deployments/${deploymentId}/files/content`,
    { query: { path } },
  );
}

export function saveDeploymentFileContent(payload: {
  deploymentId: string;
  path: string;
  content: string;
}) {
  return apiRequest<{ path: string; size: number; updatedAt: string }>(
    `/runner/deployments/${payload.deploymentId}/files/content`,
    {
      method: 'PUT',
      body: { path: payload.path, content: payload.content },
    },
  );
}

// ---------- Documents ----------

export type DocumentFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'png' | 'md' | 'txt';

export interface DocumentSpecBlock {
  type:
    | 'heading'
    | 'paragraph'
    | 'bullets'
    | 'numbered'
    | 'table'
    | 'image'
    | 'pageBreak'
    | 'slide';
  level?: number;
  text?: string;
  items?: string[];
  rows?: string[][];
  title?: string;
  body?: string;
}

export interface GeneratedDocument {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  spec: { title: string; blocks: DocumentSpecBlock[] };
}

export async function generateDocument(payload: {
  organizationId: string;
  workspaceId?: string;
  systemId?: string;
  format: DocumentFormat;
  title: string;
  prompt?: string;
  blocks?: DocumentSpecBlock[];
  model?: string;
}) {
  return apiRequest<GeneratedDocument>('/documents/generate', {
    method: 'POST',
    body: payload,
  });
}

export async function createSchedule(payload: {
  organizationId: string;
  workspaceId: string;
  systemId?: string;
  taskId?: string;
  recordId?: string;
  title: string;
  kind: string;
  startsAt: string;
  endsAt?: string | null;
  recurrenceRule?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return apiRequest<Schedule>('/schedule', {
    method: 'POST',
    body: payload,
  });
}

export async function updateSchedule(
  scheduleId: string,
  payload: Partial<Pick<Schedule, 'systemId' | 'taskId' | 'recordId' | 'title' | 'kind' | 'status' | 'startsAt' | 'endsAt' | 'recurrenceRule' | 'metadata'>>,
) {
  return apiRequest<Schedule>(`/schedule/${scheduleId}`, {
    method: 'PATCH',
    body: payload,
  });
}

// ── Meeting bot ────────────────────────────────────────────────────

export type MeetingBotStatus =
  | 'queued'
  | 'joining'
  | 'in_meeting'
  | 'summarising'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MeetingBotSession {
  id: string;
  organizationId: string;
  workspaceId: string;
  requestedByUserId: string;
  roomId: string | null;
  provider: string;
  meetingUrl: string;
  displayName: string;
  title: string | null;
  status: MeetingBotStatus;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  summaryMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingBotTranscriptLine {
  id: string;
  speakerLabel: string | null;
  text: string;
  startsAtSec: number | null;
  createdAt: string;
}

export async function fetchMeetingBotSessions(query: { organizationId: string }) {
  return apiRequest<MeetingBotSession[]>('/meeting-bot/sessions', { query });
}

export async function fetchMeetingBotSession(sessionId: string) {
  return apiRequest<MeetingBotSession>(`/meeting-bot/sessions/${sessionId}`);
}

export async function fetchMeetingBotTranscript(sessionId: string) {
  return apiRequest<MeetingBotTranscriptLine[]>(
    `/meeting-bot/sessions/${sessionId}/transcript`,
  );
}

export async function scheduleMeetingBot(payload: {
  organizationId: string;
  workspaceId: string;
  meetingUrl: string;
  title?: string;
  roomId?: string;
}) {
  return apiRequest<MeetingBotSession>('/meeting-bot/sessions', {
    method: 'POST',
    body: payload,
  });
}

/** Member of an organization with the user's profile inlined so the
 *  UI can render names + avatars without a separate user fetch. */
export interface OrganizationMember {
  id: string;
  userId: string;
  organizationId: string;
  workspaceId: string | null;
  role: string;
  status: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarFileId: string | null;
    updatedAt: string;
  } | null;
}

export async function fetchOrganizationMembers(organizationId: string) {
  return apiRequest<OrganizationMember[]>(`/memberships/with-users`, {
    query: { organizationId },
  });
}

export async function inviteOrganizationMember(payload: {
  organizationId: string;
  email: string;
  role?: string;
}) {
  return apiRequest<{ id: string; email: string }>(`/memberships/invite`, {
    method: 'POST',
    body: payload,
  });
}

export async function removeMembership(membershipId: string) {
  return apiRequest<{ id: string }>(`/memberships/${membershipId}`, {
    method: 'DELETE',
  });
}

export async function speakInMeeting(sessionId: string, text: string) {
  return apiRequest<{ enqueued: boolean }>(
    `/meeting-bot/sessions/${sessionId}/speak`,
    { method: 'POST', body: { text } },
  );
}



