// Core type definitions for Stack62's internal object model

export type FieldType =
  | "text"
  | "number"
  | "email"
  | "phone"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "reference"
  | "file"
  | "richtext"
  | "currency"
  | "percentage";

export type ViewType =
  | "table"
  | "kanban"
  | "calendar"
  | "gallery"
  | "form"
  | "dashboard"
  | "chart"
  | "timeline";

export type WorkflowTrigger =
  | "record_created"
  | "record_updated"
  | "record_deleted"
  | "field_changed"
  | "status_changed"
  | "scheduled"
  | "manual";

export type WorkflowActionType =
  | "send_notification"
  | "send_email"
  | "create_record"
  | "update_record"
  | "require_approval"
  | "assign_task"
  | "run_automation";

export type PermissionLevel =
  | "none"
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "admin";

export type ShareMode = "template" | "clone" | "live";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  ownerId: string;
  settings: {
    allowSystemCreation: boolean;
    requireApproval: boolean;
    maxSystems?: number;
  };
}

export interface Workspace {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  purpose: string;
  industry?: string;
  status: "draft" | "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  version: number;
  modules: Module[];
  shareMode?: ShareMode;
  templateId?: string;
}

export interface Module {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  icon: string;
  entities: Entity[];
  views: ViewDefinition[];
  workflows: WorkflowDefinition[];
  order: number;
}

export interface Entity {
  id: string;
  moduleId: string;
  name: string;
  pluralName: string;
  description?: string;
  fields: Field[];
  relationships: Relationship[];
  permissions: PermissionPolicy[];
}

export interface Field {
  id: string;
  entityId: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  defaultValue?: any;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
  };
  computed?: {
    expression: string;
  };
  masked?: boolean; // For sensitive fields
  order: number;
}

export interface Relationship {
  id: string;
  entityId: string;
  type: "one-to-one" | "one-to-many" | "many-to-many";
  targetEntityId: string;
  name: string;
  inverseName?: string;
  cascadeDelete?: boolean;
}

export interface ViewDefinition {
  id: string;
  moduleId: string;
  name: string;
  type: ViewType;
  entityId: string;
  config: {
    fields?: string[]; // field IDs to show
    filters?: Filter[];
    sorts?: Sort[];
    groupBy?: string;
    layout?: any; // Type-specific layout config
  };
  permissions: PermissionPolicy[];
}

export interface Filter {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "less_than"
    | "is_empty"
    | "is_not_empty";
  value: any;
}

export interface Sort {
  field: string;
  direction: "asc" | "desc";
}

export interface WorkflowDefinition {
  id: string;
  moduleId: string;
  name: string;
  description?: string;
  entityId: string;
  enabled: boolean;
  trigger: {
    type: WorkflowTrigger;
    config?: any;
  };
  conditions?: WorkflowCondition[];
  actions: WorkflowAction[];
  requiresApproval?: boolean;
}

export interface WorkflowCondition {
  field: string;
  operator: string;
  value: any;
  logicalOperator?: "AND" | "OR";
}

export interface WorkflowAction {
  id: string;
  type: WorkflowActionType;
  config: any;
  order: number;
  waitForCompletion?: boolean;
}

export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  schedule?: string; // cron expression
  enabled: boolean;
  actions: WorkflowAction[];
}

export interface PermissionPolicy {
  id: string;
  resourceType: "workspace" | "module" | "entity" | "view" | "field";
  resourceId: string;
  roleId: string;
  level: PermissionLevel;
  conditions?: any;
}

export interface Role {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  isSystemRole: boolean;
  permissions: PermissionPolicy[];
}

export interface AgentTool {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  entityId?: string;
  action:
    | "query"
    | "create"
    | "update"
    | "delete"
    | "summarize"
    | "recommend"
    | "analyze";
  config: any;
  requiredPermissions: PermissionLevel[];
}

export interface VersionSnapshot {
  id: string;
  workspaceId: string;
  version: number;
  createdAt: Date;
  createdBy: string;
  description: string;
  changeType: "creation" | "extension" | "modification" | "rollback";
  changes: ChangeRecord[];
  state: any; // Full workspace state at this version
}

export interface ChangeRecord {
  id: string;
  versionSnapshotId: string;
  resourceType: string;
  resourceId: string;
  action: "create" | "update" | "delete";
  before?: any;
  after?: any;
  aiGenerated: boolean;
  approved: boolean;
  approvedBy?: string;
  approvedAt?: Date;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  workspaceId?: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  userId: string;
  action: string;
  details: any;
  timestamp: Date;
  ipAddress?: string;
}

export interface SharePackage {
  id: string;
  workspaceId: string;
  mode: ShareMode;
  name: string;
  description?: string;
  includeData: boolean;
  maskSensitiveFields: boolean;
  createdAt: Date;
  createdBy: string;
  accessCode?: string;
  expiresAt?: Date;
  usageCount: number;
}

export interface SystemTemplate {
  id: string;
  name: string;
  description: string;
  industry: string;
  icon: string;
  modules: Omit<Module, "id" | "workspaceId">[];
  previewImages?: string[];
  featured: boolean;
  usageCount: number;
}

export interface AIGenerationRequest {
  id: string;
  tenantId: string;
  userId: string;
  prompt: string;
  requestType: "create_system" | "extend_system" | "modify_system";
  workspaceId?: string;
  status: "pending" | "processing" | "review" | "approved" | "rejected" | "completed";
  result?: {
    workspace?: Workspace;
    changes?: ChangeRecord[];
    rationale?: string;
  };
  createdAt: Date;
  processedAt?: Date;
}
