import { z } from 'zod';

const fieldPlanSchema = z.object({
  name: z.string().min(2),
  key: z.string().min(2),
  dataType: z.string().min(2),
  required: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
});

const entityPlanSchema = z.object({
  name: z.string().min(2),
  key: z.string().min(2),
  description: z.string().optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
  fields: z.array(fieldPlanSchema).default([]),
});

const modulePlanSchema = z.object({
  name: z.string().min(2),
  key: z.string().min(2),
  description: z.string().optional().nullable(),
  kind: z.string().default('custom'),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
  entities: z.array(entityPlanSchema).default([]),
});

const dashboardPlanSchema = z.object({
  name: z.string().min(2),
  scope: z.string().default('system'),
  widgets: z.array(z.record(z.string(), z.unknown())).default([]),
});

const workflowPlanSchema = z.object({
  name: z.string().min(2),
  key: z.string().min(2).optional().nullable(),
  triggerType: z.string().min(2),
  moduleKey: z.string().min(2).optional().nullable(),
  definition: z.record(z.string(), z.unknown()).default({}),
});

const permissionPolicyPlanSchema = z.object({
  name: z.string().min(2),
  scope: z.string().min(2),
  role: z.string().min(2),
  resourceType: z.string().min(2),
  actions: z.array(z.string().min(1)).min(1),
  fieldRestrictions: z.record(z.string(), z.unknown()).optional().nullable(),
  conditions: z.record(z.string(), z.unknown()).optional().nullable(),
});

const artifactPlanSchema = z.object({
  kind: z.string().min(2),
  relativePath: z.string().min(3),
  content: z.string().min(1),
  overwrite: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const viewPlanSchema = z.object({
  name: z.string().min(2),
  type: z.string().min(2),
  entityKey: z.string().optional().nullable(),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const createSystemPlanSchema = z.object({
  intent: z.literal('create_system'),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  industryType: z.string().optional().nullable(),
  governanceMode: z.string().default('standard'),
  visibility: z.string().default('private'),
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  modules: z.array(modulePlanSchema).min(1),
  views: z.array(viewPlanSchema).default([]),
  dashboards: z.array(dashboardPlanSchema).default([]),
  workflows: z.array(workflowPlanSchema).default([]),
  permissionPolicies: z.array(permissionPolicyPlanSchema).default([]),
  artifacts: z.array(artifactPlanSchema).default([]),
});

export const updateSystemPlanSchema = z.object({
  intent: z.enum(['update_system', 'add_module']),
  systemId: z.string().uuid(),
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  modules: z.array(modulePlanSchema).default([]),
  views: z.array(viewPlanSchema).default([]),
  dashboards: z.array(dashboardPlanSchema).default([]),
  workflows: z.array(workflowPlanSchema).default([]),
  permissionPolicies: z.array(permissionPolicyPlanSchema).default([]),
  artifacts: z.array(artifactPlanSchema).default([]),
});

export const aiChangePlanSchema = z.union([
  createSystemPlanSchema,
  updateSystemPlanSchema,
]);

export type AiChangePlan = z.infer<typeof aiChangePlanSchema>;
