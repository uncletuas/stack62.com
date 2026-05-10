import type { AnthropicTool } from '../anthropic.client';

export type ToolActorKind = 'user' | 'coworker';

export interface ToolActor {
  kind: ToolActorKind;
  userId: string;
  coworkerId?: string | null;
  coworkerName?: string | null;
  coworkerRole?: string | null;
}

export interface ToolContext {
  organizationId: string;
  workspaceId?: string | null;
  systemId?: string | null;
  actorUserId: string;
  autopilot?: boolean;
  /**
   * Optional: when the model is acting as a Coworker member rather than as
   * the human user, the runtime gates tool calls against the Coworker's role
   * AND the human's role (intersection). Logs identify the Coworker as the
   * acting party.
   */
  actor?: ToolActor;
}

export interface ToolHandlerResult {
  output: unknown;
  summary?: string;
}

export interface ToolDefinition {
  name: string;
  spec: AnthropicTool;
  permission?: string;
  actionLevel?: 1 | 2 | 3 | 4;
  requiresConfirmation?: boolean;
  sensitive?: boolean;
  auditAction?: string;
  responseSchema?: Record<string, unknown>;
  handler: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolHandlerResult> | ToolHandlerResult;
}

export type ToolRegistry = Record<string, ToolDefinition>;

export function tool(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  handler: ToolDefinition['handler'],
  metadata?: Omit<ToolDefinition, 'name' | 'spec' | 'handler'>,
): ToolDefinition {
  return {
    name,
    spec: {
      name,
      description,
      input_schema: {
        type: 'object',
        ...schema,
      },
    },
    actionLevel: metadata?.actionLevel ?? inferActionLevel(name),
    permission: metadata?.permission,
    requiresConfirmation:
      metadata?.requiresConfirmation ?? inferActionLevel(name) >= 3,
    sensitive: metadata?.sensitive ?? /\b(send|delete|share|payment)\b/i.test(name),
    auditAction: metadata?.auditAction,
    responseSchema: metadata?.responseSchema,
    handler,
  };
}

function inferActionLevel(name: string): 1 | 2 | 3 | 4 {
  if (/\b(draft|prepare|suggest)\b/i.test(name)) return 2;
  if (/\b(create|update|assign|edit|send|book|share|delete|apply|deploy|run|pause|resume|stop)\b/i.test(name)) {
    return 3;
  }
  return 1;
}

/**
 * Lightweight runtime validation: inputs must be a plain object and any field
 * declared `required` in the tool's JSON Schema must be present and non-null.
 * Anthropic already enforces the schema, so this is a defensive backstop.
 */
export function validateToolInput(
  spec: AnthropicTool,
  input: unknown,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Tool input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const schema = spec.input_schema as { required?: string[]; properties?: Record<string, unknown> };
  for (const key of schema.required ?? []) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
      return { ok: false, error: `Missing required field "${key}".` };
    }
  }
  return { ok: true, input: obj };
}
