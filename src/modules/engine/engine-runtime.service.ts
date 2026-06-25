import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AccessAction,
  AccessResource,
} from '../../shared/access-control/access-control.decorator';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { ToolCallLogEntity } from './entities/tool-call-log.entity';
import {
  validateToolInput,
  type ToolContext,
  type ToolDefinition,
  type ToolHandlerResult,
} from './tools/types';

type ToolRunStatus = 'succeeded' | 'failed' | 'blocked';

export interface EngineRuntimeExecuteInput {
  tool: ToolDefinition;
  input: Record<string, unknown>;
  ctx: ToolContext;
}

@Injectable()
export class EngineRuntimeService {
  constructor(
    @InjectRepository(ToolCallLogEntity)
    private readonly toolCallLogsRepository: Repository<ToolCallLogEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async execute({
    tool,
    input,
    ctx,
  }: EngineRuntimeExecuteInput): Promise<ToolHandlerResult> {
    const validated = validateToolInput(tool.spec, input ?? {});
    if (!validated.ok) {
      throw new Error(validated.error);
    }

    await this.assertToolPermission(tool, ctx);

    if (this.shouldBlockForConfirmation(tool, validated.input, ctx)) {
      const blocked = {
        confirmationRequired: true,
        tool: tool.name,
        actionLevel: tool.actionLevel ?? 3,
        confirmationToken: 'confirmed',
      };
      await this.logToolCall(tool, validated.input, ctx, 'blocked', blocked);
      return {
        output: blocked,
        summary: `${tool.name} requires confirmation before applying changes.`,
      };
    }

    try {
      const result = await tool.handler(validated.input, ctx);
      await this.logToolCall(
        tool,
        validated.input,
        ctx,
        'succeeded',
        result.output,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool failed.';
      await this.logToolCall(tool, validated.input, ctx, 'failed', {
        error: message,
      });
      throw err;
    }
  }

  private shouldBlockForConfirmation(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) {
    if (!tool.requiresConfirmation) return false;
    if (ctx.autopilot && this.autopilotCanRun(tool)) return false;
    return input.confirmationToken !== 'confirmed';
  }

  private autopilotCanRun(tool: ToolDefinition) {
    if ((tool.actionLevel ?? 1) <= 3) return true;
    return ['jobs.create', 'schedules.create', 'reports.generate'].includes(
      tool.name,
    );
  }

  private async assertToolPermission(tool: ToolDefinition, ctx: ToolContext) {
    const requirement = this.resolvePermission(tool);
    if (!requirement) return;
    // Always require the human user to have access — they own the session.
    await this.accessControlService.assertResolvedAccess(ctx.actorUserId, {
      resource: requirement.resource,
      action: requirement.action,
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      systemId: ctx.systemId,
    });
    // If a Coworker is the acting actor, additionally cap by its role.
    if (ctx.actor?.kind === 'coworker' && ctx.actor.coworkerRole) {
      await this.accessControlService.assertCoworkerCanAct(
        ctx.actor.coworkerRole,
        {
          resource: requirement.resource,
          action: requirement.action,
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          systemId: ctx.systemId,
        },
      );
    }
  }

  private resolvePermission(
    tool: ToolDefinition,
  ): { resource: AccessResource; action: AccessAction } | null {
    if (tool.permission) {
      const [resource, action] = tool.permission.split(':');
      if (resource && action) {
        return {
          resource: resource as AccessResource,
          action: action as AccessAction,
        };
      }
    }

    const [prefix, verb = 'read'] = tool.name.split('.');
    const action = this.actionForVerb(verb);
    const resource = this.resourceForPrefix(prefix);
    if (!resource || !action) return null;
    return { resource, action };
  }

  private resourceForPrefix(prefix: string): AccessResource | null {
    const map: Record<string, AccessResource> = {
      workspace: 'workspace',
      systems: 'system',
      system: 'system',
      records: 'record',
      tasks: 'task',
      schedules: 'schedule',
      workflows: 'workflow_definition',
      workflow: 'workflow_definition',
      files: 'file',
      documents: 'document',
      reports: 'report',
      integrations: 'integration',
      jobs: 'background_job',
      plans: 'ai_change_request',
      runner: 'system',
      commands: 'tool_call',
    };
    return map[prefix] ?? null;
  }

  private actionForVerb(verb: string): AccessAction | null {
    if (['search', 'read', 'get', 'list', 'find'].includes(verb)) return 'read';
    if (['create', 'upload', 'generate', 'draft'].includes(verb))
      return 'create';
    if (
      ['update', 'edit', 'assign', 'rewrite', 'pause', 'resume'].includes(verb)
    ) {
      return 'update';
    }
    if (['share'].includes(verb)) return 'share';
    if (['apply', 'run', 'deploy', 'start', 'stop', 'repair'].includes(verb)) {
      return 'apply_ai';
    }
    if (['send', 'book'].includes(verb)) return 'create';
    return 'read';
  }

  private async logToolCall(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    ctx: ToolContext,
    status: ToolRunStatus,
    output: unknown,
  ) {
    const actor = ctx.actor ?? {
      kind: 'user' as const,
      userId: ctx.actorUserId,
    };
    const actorMeta = {
      kind: actor.kind,
      userId: actor.userId,
      coworkerId: actor.coworkerId ?? null,
      coworkerName: actor.coworkerName ?? null,
      coworkerRole: actor.coworkerRole ?? null,
    };
    const saved = await this.toolCallLogsRepository.save(
      this.toolCallLogsRepository.create({
        organizationId: ctx.organizationId ?? null,
        workspaceId: ctx.workspaceId ?? null,
        systemId: ctx.systemId ?? null,
        actorUserId: ctx.actorUserId ?? null,
        toolName: tool.name,
        actionLevel: tool.actionLevel ?? 1,
        status,
        input,
        output:
          output && typeof output === 'object'
            ? (output as Record<string, unknown>)
            : { value: output },
        errorMessage:
          status === 'failed' &&
          output &&
          typeof output === 'object' &&
          'error' in output
            ? String((output as Record<string, unknown>).error)
            : null,
        metadata: {
          permission: tool.permission ?? null,
          sensitive: tool.sensitive ?? false,
          requiresConfirmation: tool.requiresConfirmation ?? false,
          actor: actorMeta,
        },
      }),
    );

    await this.activityService.log({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId ?? null,
      systemId: ctx.systemId ?? null,
      actorUserId: ctx.actorUserId,
      action: `tool.${status}`,
      targetType: 'tool_call',
      targetId: saved.id,
      origin: 'ai',
      metadata: {
        toolName: tool.name,
        actionLevel: tool.actionLevel ?? 1,
        actor: actorMeta,
      },
    });

    if (tool.sensitive || status === 'blocked') {
      await this.auditService.log({
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId ?? null,
        systemId: ctx.systemId ?? null,
        actorUserId: ctx.actorUserId,
        action: tool.auditAction ?? `tool.${tool.name}.${status}`,
        targetType: 'tool_call',
        targetId: saved.id,
        origin: 'ai',
        afterData: { ...saved, actor: actorMeta },
      });
    }
  }
}
