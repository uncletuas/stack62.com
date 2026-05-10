import { z } from 'zod';
import { fieldDataTypeSchema } from './field-types';

const jsonRecordSchema = z.record(z.string(), z.unknown());

const fieldConfigSchema = z
  .object({
    options: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    pattern: z.string().optional(),
    referenceEntityKey: z.string().optional(),
    masked: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    helpText: z.string().optional(),
  })
  .catchall(z.unknown());

export const fieldDefinitionSchema = z.object({
  name: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/i, {
      message: 'Field key must be alphanumeric or underscore',
    }),
  dataType: fieldDataTypeSchema,
  required: z.boolean().default(false),
  config: fieldConfigSchema.optional().nullable(),
});

export const entityDefinitionSchema = z.object({
  name: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/i),
  description: z.string().optional().nullable(),
  config: jsonRecordSchema.optional().nullable(),
  fields: z.array(fieldDefinitionSchema).default([]),
});

export const moduleDefinitionSchema = z.object({
  name: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/i),
  kind: z.string().default('custom'),
  description: z.string().optional().nullable(),
  config: jsonRecordSchema.optional().nullable(),
  entities: z.array(entityDefinitionSchema).default([]),
});

export const viewDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['table', 'form', 'kanban', 'calendar', 'chart', 'card']),
  entityKey: z.string().optional().nullable(),
  config: jsonRecordSchema.optional().nullable(),
});

export const dashboardDefinitionSchema = z.object({
  name: z.string().min(1),
  scope: z.string().default('system'),
  widgets: z.array(jsonRecordSchema).default([]),
});

export const workflowDefinitionSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1).optional().nullable(),
  triggerType: z.string().min(1),
  moduleKey: z.string().optional().nullable(),
  definition: jsonRecordSchema.default({}),
});

export const permissionPolicyDefinitionSchema = z.object({
  name: z.string().min(1),
  scope: z.string().min(1),
  role: z.string().min(1),
  resourceType: z.string().min(1),
  actions: z.array(z.string().min(1)).min(1),
  fieldRestrictions: jsonRecordSchema.optional().nullable(),
  conditions: jsonRecordSchema.optional().nullable(),
});

export const systemDefinitionSchema = z.object({
  name: z.string().min(1),
  purpose: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  teamSize: z.number().int().positive().optional().nullable(),
  industryType: z.string().optional().nullable(),
  governanceMode: z.string().default('standard'),
  visibility: z.string().default('private'),
  modules: z.array(moduleDefinitionSchema).default([]),
  views: z.array(viewDefinitionSchema).default([]),
  dashboards: z.array(dashboardDefinitionSchema).default([]),
  workflows: z.array(workflowDefinitionSchema).default([]),
  permissionPolicies: z.array(permissionPolicyDefinitionSchema).default([]),
});

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type EntityDefinition = z.infer<typeof entityDefinitionSchema>;
export type ModuleDefinition = z.infer<typeof moduleDefinitionSchema>;
export type ViewDefinition = z.infer<typeof viewDefinitionSchema>;
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type PermissionPolicyDefinition = z.infer<
  typeof permissionPolicyDefinitionSchema
>;
export type SystemDefinition = z.infer<typeof systemDefinitionSchema>;

export function parseSystemDefinition(input: unknown): SystemDefinition {
  return systemDefinitionSchema.parse(input);
}

export function safeParseSystemDefinition(input: unknown) {
  return systemDefinitionSchema.safeParse(input);
}

export function validateUniqueKeys(definition: SystemDefinition): string[] {
  const issues: string[] = [];

  const moduleKeys = new Set<string>();
  for (const module of definition.modules) {
    if (moduleKeys.has(module.key)) {
      issues.push(`Duplicate module key: ${module.key}`);
    }
    moduleKeys.add(module.key);

    const entityKeys = new Set<string>();
    for (const entity of module.entities) {
      const qualifiedKey = `${module.key}.${entity.key}`;
      if (entityKeys.has(entity.key)) {
        issues.push(
          `Duplicate entity key in module ${module.key}: ${entity.key}`,
        );
      }
      entityKeys.add(entity.key);

      const fieldKeys = new Set<string>();
      for (const field of entity.fields) {
        if (fieldKeys.has(field.key)) {
          issues.push(`Duplicate field key in ${qualifiedKey}: ${field.key}`);
        }
        fieldKeys.add(field.key);
      }
    }
  }

  return issues;
}
