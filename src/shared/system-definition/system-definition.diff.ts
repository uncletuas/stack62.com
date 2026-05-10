import {
  EntityDefinition,
  FieldDefinition,
  ModuleDefinition,
  PermissionPolicyDefinition,
  SystemDefinition,
  WorkflowDefinition,
} from './system-definition.schema';

export type DiffOperation = 'add' | 'remove' | 'modify';

export type DiffItemKind =
  | 'module'
  | 'entity'
  | 'field'
  | 'workflow'
  | 'permission';

export interface FieldDiffItem {
  id: string;
  kind: 'field';
  op: DiffOperation;
  moduleKey: string;
  entityKey: string;
  fieldKey: string;
  before?: FieldDefinition;
  after?: FieldDefinition;
  riskScore: number;
  reasons: string[];
}

export interface EntityDiffItem {
  id: string;
  kind: 'entity';
  op: DiffOperation;
  moduleKey: string;
  entityKey: string;
  before?: EntityDefinition;
  after?: EntityDefinition;
  riskScore: number;
  reasons: string[];
}

export interface ModuleDiffItem {
  id: string;
  kind: 'module';
  op: DiffOperation;
  moduleKey: string;
  before?: ModuleDefinition;
  after?: ModuleDefinition;
  riskScore: number;
  reasons: string[];
}

export interface WorkflowDiffItem {
  id: string;
  kind: 'workflow';
  op: DiffOperation;
  key: string;
  before?: WorkflowDefinition;
  after?: WorkflowDefinition;
  riskScore: number;
  reasons: string[];
}

export interface PermissionDiffItem {
  id: string;
  kind: 'permission';
  op: DiffOperation;
  identity: string;
  before?: PermissionPolicyDefinition;
  after?: PermissionPolicyDefinition;
  riskScore: number;
  reasons: string[];
}

export type AnyDiffItem =
  | ModuleDiffItem
  | EntityDiffItem
  | FieldDiffItem
  | WorkflowDiffItem
  | PermissionDiffItem;

export interface SystemDefinitionDiff {
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
}

function scoreField(item: FieldDiffItem) {
  if (item.op === 'remove') {
    item.riskScore += 40;
    item.reasons.push('Removing a field drops existing data.');
  }
  if (
    item.op === 'add' &&
    item.after?.required &&
    !item.after.config?.defaultValue
  ) {
    item.riskScore += 20;
    item.reasons.push(
      'New required field without a default will fail on old records.',
    );
  }
  if (item.op === 'modify' && item.before && item.after) {
    if (item.before.dataType !== item.after.dataType) {
      item.riskScore += 30;
      item.reasons.push(
        `Data type changed (${item.before.dataType} → ${item.after.dataType}).`,
      );
    }
    if (!item.before.required && item.after.required) {
      item.riskScore += 15;
      item.reasons.push('Field became required.');
    }
  }
}

function scoreEntity(item: EntityDiffItem) {
  if (item.op === 'remove') {
    item.riskScore += 50;
    item.reasons.push('Removing an entity discards all its records.');
  }
}

function scoreModule(item: ModuleDiffItem) {
  if (item.op === 'remove') {
    item.riskScore += 60;
    item.reasons.push(
      'Removing a module removes all child entities and records.',
    );
  }
}

function scoreWorkflow(item: WorkflowDiffItem) {
  if (item.op === 'remove') {
    item.riskScore += 25;
    item.reasons.push(
      'Removing an active workflow may break running processes.',
    );
  }
  if (item.op === 'modify') {
    item.riskScore += 10;
    item.reasons.push('Workflow definition modified.');
  }
}

function scorePermission(item: PermissionDiffItem) {
  const actions = item.after?.actions ?? item.before?.actions ?? [];
  const isSensitive = actions.some((action) =>
    ['delete', 'publish', 'manage_permissions', 'manage_ai'].includes(action),
  );
  if (item.op !== 'remove' && isSensitive) {
    item.riskScore += 20;
    item.reasons.push('Policy grants sensitive actions.');
  }
  if (item.op === 'remove') {
    item.riskScore += 10;
    item.reasons.push(
      'Removing a policy may reduce access for existing users.',
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function moduleDiffId(op: DiffOperation, moduleKey: string) {
  return `module:${op}:${moduleKey}`;
}
export function entityDiffId(
  op: DiffOperation,
  moduleKey: string,
  entityKey: string,
) {
  return `entity:${op}:${moduleKey}:${entityKey}`;
}
export function fieldDiffId(
  op: DiffOperation,
  moduleKey: string,
  entityKey: string,
  fieldKey: string,
) {
  return `field:${op}:${moduleKey}:${entityKey}:${fieldKey}`;
}
export function workflowDiffId(op: DiffOperation, key: string) {
  return `workflow:${op}:${key}`;
}
export function permissionDiffId(op: DiffOperation, identity: string) {
  return `permission:${op}:${identity}`;
}

function policyIdentity(p: PermissionPolicyDefinition) {
  return `${p.role}::${p.resourceType}::${p.scope}::${p.name}`;
}
function workflowIdentity(w: WorkflowDefinition) {
  return w.key ?? w.name;
}

export function diffSystemDefinition(
  before: SystemDefinition,
  after: SystemDefinition,
): SystemDefinitionDiff {
  const modules: ModuleDiffItem[] = [];
  const entities: EntityDiffItem[] = [];
  const fields: FieldDiffItem[] = [];
  const workflows: WorkflowDiffItem[] = [];
  const permissions: PermissionDiffItem[] = [];

  const beforeModules = new Map(before.modules.map((m) => [m.key, m]));
  const afterModules = new Map(after.modules.map((m) => [m.key, m]));

  for (const [key, moduleBefore] of beforeModules) {
    if (!afterModules.has(key)) {
      const item: ModuleDiffItem = {
        id: moduleDiffId('remove', key),
        kind: 'module',
        op: 'remove',
        moduleKey: key,
        before: moduleBefore,
        riskScore: 0,
        reasons: [],
      };
      scoreModule(item);
      modules.push(item);
    }
  }

  for (const [key, moduleAfter] of afterModules) {
    const moduleBefore = beforeModules.get(key);
    if (!moduleBefore) {
      const item: ModuleDiffItem = {
        id: moduleDiffId('add', key),
        kind: 'module',
        op: 'add',
        moduleKey: key,
        after: moduleAfter,
        riskScore: 2,
        reasons: ['New module added.'],
      };
      modules.push(item);
    }

    const beforeEntities = new Map(
      (moduleBefore?.entities ?? []).map((e) => [e.key, e]),
    );
    const afterEntities = new Map(moduleAfter.entities.map((e) => [e.key, e]));

    for (const [entityKey, entityBefore] of beforeEntities) {
      if (!afterEntities.has(entityKey)) {
        const item: EntityDiffItem = {
          id: entityDiffId('remove', key, entityKey),
          kind: 'entity',
          op: 'remove',
          moduleKey: key,
          entityKey,
          before: entityBefore,
          riskScore: 0,
          reasons: [],
        };
        scoreEntity(item);
        entities.push(item);
      }
    }

    for (const [entityKey, entityAfter] of afterEntities) {
      const entityBefore = beforeEntities.get(entityKey);
      if (!entityBefore) {
        const item: EntityDiffItem = {
          id: entityDiffId('add', key, entityKey),
          kind: 'entity',
          op: 'add',
          moduleKey: key,
          entityKey,
          after: entityAfter,
          riskScore: 2,
          reasons: ['New entity added.'],
        };
        entities.push(item);
      }

      const beforeFields = new Map(
        (entityBefore?.fields ?? []).map((f) => [f.key, f]),
      );
      const afterFields = new Map(entityAfter.fields.map((f) => [f.key, f]));

      for (const [fieldKey, fieldBefore] of beforeFields) {
        if (!afterFields.has(fieldKey)) {
          const item: FieldDiffItem = {
            id: fieldDiffId('remove', key, entityKey, fieldKey),
            kind: 'field',
            op: 'remove',
            moduleKey: key,
            entityKey,
            fieldKey,
            before: fieldBefore,
            riskScore: 0,
            reasons: [],
          };
          scoreField(item);
          fields.push(item);
        }
      }

      for (const [fieldKey, fieldAfter] of afterFields) {
        const fieldBefore = beforeFields.get(fieldKey);
        if (!fieldBefore) {
          const item: FieldDiffItem = {
            id: fieldDiffId('add', key, entityKey, fieldKey),
            kind: 'field',
            op: 'add',
            moduleKey: key,
            entityKey,
            fieldKey,
            after: fieldAfter,
            riskScore: 0,
            reasons: [],
          };
          scoreField(item);
          fields.push(item);
          continue;
        }
        if (!deepEqual(fieldBefore, fieldAfter)) {
          const item: FieldDiffItem = {
            id: fieldDiffId('modify', key, entityKey, fieldKey),
            kind: 'field',
            op: 'modify',
            moduleKey: key,
            entityKey,
            fieldKey,
            before: fieldBefore,
            after: fieldAfter,
            riskScore: 0,
            reasons: [],
          };
          scoreField(item);
          fields.push(item);
        }
      }
    }
  }

  const beforeWorkflows = new Map(
    before.workflows.map((w) => [w.key ?? w.name, w]),
  );
  const afterWorkflows = new Map(
    after.workflows.map((w) => [w.key ?? w.name, w]),
  );

  for (const [key, wf] of beforeWorkflows) {
    if (!afterWorkflows.has(key)) {
      const item: WorkflowDiffItem = {
        id: workflowDiffId('remove', key),
        kind: 'workflow',
        op: 'remove',
        key,
        before: wf,
        riskScore: 0,
        reasons: [],
      };
      scoreWorkflow(item);
      workflows.push(item);
    }
  }
  for (const [key, wf] of afterWorkflows) {
    const existing = beforeWorkflows.get(key);
    if (!existing) {
      workflows.push({
        id: workflowDiffId('add', key),
        kind: 'workflow',
        op: 'add',
        key,
        after: wf,
        riskScore: 3,
        reasons: ['New workflow added.'],
      });
    } else if (!deepEqual(existing, wf)) {
      const item: WorkflowDiffItem = {
        id: workflowDiffId('modify', key),
        kind: 'workflow',
        op: 'modify',
        key,
        before: existing,
        after: wf,
        riskScore: 0,
        reasons: [],
      };
      scoreWorkflow(item);
      workflows.push(item);
    }
  }

  const beforePolicies = new Map(
    before.permissionPolicies.map((p) => [policyIdentity(p), p]),
  );
  const afterPolicies = new Map(
    after.permissionPolicies.map((p) => [policyIdentity(p), p]),
  );

  for (const [identity, policy] of beforePolicies) {
    if (!afterPolicies.has(identity)) {
      const item: PermissionDiffItem = {
        id: permissionDiffId('remove', identity),
        kind: 'permission',
        op: 'remove',
        identity,
        before: policy,
        riskScore: 0,
        reasons: [],
      };
      scorePermission(item);
      permissions.push(item);
    }
  }

  for (const [identity, policy] of afterPolicies) {
    const existing = beforePolicies.get(identity);
    if (!existing) {
      const item: PermissionDiffItem = {
        id: permissionDiffId('add', identity),
        kind: 'permission',
        op: 'add',
        identity,
        after: policy,
        riskScore: 0,
        reasons: [],
      };
      scorePermission(item);
      permissions.push(item);
    } else if (!deepEqual(existing, policy)) {
      const item: PermissionDiffItem = {
        id: permissionDiffId('modify', identity),
        kind: 'permission',
        op: 'modify',
        identity,
        before: existing,
        after: policy,
        riskScore: 0,
        reasons: [],
      };
      scorePermission(item);
      permissions.push(item);
    }
  }

  const totalScore =
    modules.reduce((sum, m) => sum + m.riskScore, 0) +
    entities.reduce((sum, e) => sum + e.riskScore, 0) +
    fields.reduce((sum, f) => sum + f.riskScore, 0) +
    workflows.reduce((sum, w) => sum + w.riskScore, 0) +
    permissions.reduce((sum, p) => sum + p.riskScore, 0);

  const riskLevel: 'low' | 'medium' | 'high' =
    totalScore >= 50 ? 'high' : totalScore >= 20 ? 'medium' : 'low';

  return {
    modules,
    entities,
    fields,
    workflows,
    permissions,
    riskScore: totalScore,
    riskLevel,
    summary: {
      modulesAdded: modules.filter((m) => m.op === 'add').length,
      modulesRemoved: modules.filter((m) => m.op === 'remove').length,
      entitiesAdded: entities.filter((e) => e.op === 'add').length,
      entitiesRemoved: entities.filter((e) => e.op === 'remove').length,
      fieldsAdded: fields.filter((f) => f.op === 'add').length,
      fieldsRemoved: fields.filter((f) => f.op === 'remove').length,
      fieldsModified: fields.filter((f) => f.op === 'modify').length,
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build a SystemDefinition that contains only the diff items whose IDs are
 * present in `selectedIds`. Starts from `before` and re-applies each selected
 * diff item. Top-level metadata (name/description/governanceMode/visibility)
 * is taken from `after` so creating a new system with a partial selection
 * still respects the AI plan's intended top-level shape.
 */
export function applyDiffSelection(
  before: SystemDefinition,
  after: SystemDefinition,
  diff: SystemDefinitionDiff,
  selectedIds: ReadonlySet<string>,
): SystemDefinition {
  const result = clone(before);
  result.name = after.name;
  result.purpose = after.purpose;
  result.description = after.description;
  result.teamSize = after.teamSize;
  result.industryType = after.industryType;
  result.governanceMode = after.governanceMode;
  result.visibility = after.visibility;

  for (const m of diff.modules) {
    if (!selectedIds.has(m.id)) continue;
    if (m.op === 'add' && m.after) {
      const existing = result.modules.findIndex((x) => x.key === m.moduleKey);
      const skeleton: ModuleDefinition = { ...clone(m.after), entities: [] };
      if (existing >= 0) result.modules[existing] = skeleton;
      else result.modules.push(skeleton);
    } else if (m.op === 'remove') {
      result.modules = result.modules.filter((x) => x.key !== m.moduleKey);
    }
  }

  for (const e of diff.entities) {
    if (!selectedIds.has(e.id)) continue;
    const mod = result.modules.find((x) => x.key === e.moduleKey);
    if (!mod) continue;
    if (e.op === 'add' && e.after) {
      const existing = mod.entities.findIndex((x) => x.key === e.entityKey);
      const skeleton: EntityDefinition = { ...clone(e.after), fields: [] };
      if (existing >= 0) mod.entities[existing] = skeleton;
      else mod.entities.push(skeleton);
    } else if (e.op === 'remove') {
      mod.entities = mod.entities.filter((x) => x.key !== e.entityKey);
    }
  }

  for (const f of diff.fields) {
    if (!selectedIds.has(f.id)) continue;
    const mod = result.modules.find((x) => x.key === f.moduleKey);
    if (!mod) continue;
    const ent = mod.entities.find((x) => x.key === f.entityKey);
    if (!ent) continue;
    if (f.op === 'add' && f.after) {
      const idx = ent.fields.findIndex((x) => x.key === f.fieldKey);
      if (idx >= 0) ent.fields[idx] = clone(f.after);
      else ent.fields.push(clone(f.after));
    } else if (f.op === 'remove') {
      ent.fields = ent.fields.filter((x) => x.key !== f.fieldKey);
    } else if (f.op === 'modify' && f.after) {
      const idx = ent.fields.findIndex((x) => x.key === f.fieldKey);
      if (idx >= 0) ent.fields[idx] = clone(f.after);
    }
  }

  // For module-add items that ARE selected, copy any nested entities/fields
  // from `after` whose own diff IDs are also selected. This handles the
  // common path where a module is added with all its children in one plan.
  for (const m of diff.modules) {
    if (m.op !== 'add' || !selectedIds.has(m.id) || !m.after) continue;
    const mod = result.modules.find((x) => x.key === m.moduleKey);
    if (!mod) continue;
    for (const entAfter of m.after.entities) {
      const entityId = entityDiffId('add', m.moduleKey, entAfter.key);
      if (!selectedIds.has(entityId)) continue;
      if (mod.entities.some((x) => x.key === entAfter.key)) continue;
      mod.entities.push({ ...clone(entAfter), fields: [] });
    }
  }
  for (const e of diff.entities) {
    if (e.op !== 'add' || !selectedIds.has(e.id) || !e.after) continue;
    const mod = result.modules.find((x) => x.key === e.moduleKey);
    if (!mod) continue;
    const ent = mod.entities.find((x) => x.key === e.entityKey);
    if (!ent) continue;
    for (const fieldAfter of e.after.fields) {
      const fieldId = fieldDiffId(
        'add',
        e.moduleKey,
        e.entityKey,
        fieldAfter.key,
      );
      if (!selectedIds.has(fieldId)) continue;
      if (ent.fields.some((x) => x.key === fieldAfter.key)) continue;
      ent.fields.push(clone(fieldAfter));
    }
  }

  for (const w of diff.workflows) {
    if (!selectedIds.has(w.id)) continue;
    if (w.op === 'add' && w.after) {
      result.workflows.push(clone(w.after));
    } else if (w.op === 'remove') {
      result.workflows = result.workflows.filter(
        (x) => workflowIdentity(x) !== w.key,
      );
    } else if (w.op === 'modify' && w.after) {
      const idx = result.workflows.findIndex(
        (x) => workflowIdentity(x) === w.key,
      );
      if (idx >= 0) result.workflows[idx] = clone(w.after);
    }
  }

  for (const p of diff.permissions) {
    if (!selectedIds.has(p.id)) continue;
    if (p.op === 'add' && p.after) {
      result.permissionPolicies.push(clone(p.after));
    } else if (p.op === 'remove') {
      result.permissionPolicies = result.permissionPolicies.filter(
        (x) => policyIdentity(x) !== p.identity,
      );
    } else if (p.op === 'modify' && p.after) {
      const idx = result.permissionPolicies.findIndex(
        (x) => policyIdentity(x) === p.identity,
      );
      if (idx >= 0) result.permissionPolicies[idx] = clone(p.after);
    }
  }

  // Views/dashboards aren't in the diff but were merged in `after`; carry over.
  result.views = clone(after.views);
  result.dashboards = clone(after.dashboards);

  return result;
}

export function allDiffItemIds(diff: SystemDefinitionDiff): string[] {
  return [
    ...diff.modules.map((m) => m.id),
    ...diff.entities.map((e) => e.id),
    ...diff.fields.map((f) => f.id),
    ...diff.workflows.map((w) => w.id),
    ...diff.permissions.map((p) => p.id),
  ];
}

export function emptySystemDefinition(): SystemDefinition {
  return {
    name: '',
    purpose: null,
    description: null,
    teamSize: null,
    industryType: null,
    governanceMode: 'standard',
    visibility: 'private',
    modules: [],
    views: [],
    dashboards: [],
    workflows: [],
    permissionPolicies: [],
  };
}
