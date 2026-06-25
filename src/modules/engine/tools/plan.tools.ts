import { Injectable } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AiService } from '../../ai/ai.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class PlanTools {
  constructor(
    private readonly aiService: AiService,
    private readonly activityService: ActivityService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'plans.propose',
        'Create and validate a structural change to a system (add module/field, change workflow, etc.). The request auto-applies after validation unless the user explicitly asks to pause or undo.',
        {
          properties: {
            systemId: {
              type: 'string',
              description: 'Optional — pass when modifying an existing system.',
            },
            prompt: {
              type: 'string',
              description: 'Plain-English description of the change.',
            },
            autoApply: {
              type: 'boolean',
              description:
                'Set true unless the user explicitly asks to only draft.',
            },
          },
          required: ['prompt'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new Error('workspaceId is required for plans.');
          const result = await this.aiService.createRequest(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
              prompt: String(input.prompt),
              autoApply: true,
              generateArtifacts: false,
              context: { source: 'engine' },
            },
            ctx.actorUserId,
          );
          return {
            output: {
              requestId: result.request.id,
              status: result.request.status,
              riskLevel: result.request.riskLevel,
              backgroundJobId: result.backgroundJob?.id,
            },
            summary: `Proposed plan ${result.request.id.slice(0, 8)} (${result.request.status}).`,
          };
        },
      ),
      tool(
        'plans.apply',
        'Apply (approve) a previously created plan. Only call after the user has explicitly approved.',
        {
          properties: {
            requestId: { type: 'string' },
          },
          required: ['requestId'],
        },
        async (input, ctx) => {
          const result = await this.aiService.applyRequest(
            String(input.requestId),
            ctx.actorUserId,
          );
          return { output: result, summary: `Plan applied.` };
        },
      ),
      tool(
        'plans.reject',
        'Reject a plan with an optional reason.',
        {
          properties: {
            requestId: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['requestId'],
        },
        async (input, ctx) => {
          await this.aiService.rejectRequest(
            String(input.requestId),
            ctx.actorUserId,
            typeof input.reason === 'string' ? input.reason : undefined,
          );
          return { output: { ok: true }, summary: 'Plan rejected.' };
        },
      ),
      tool(
        'activity.recent',
        'Read the most recent activity entries (audit-style log of who did what).',
        {
          properties: {
            systemId: { type: 'string' },
            limit: { type: 'number', description: 'Max entries (default 30).' },
          },
        },
        async (input, ctx) => {
          const rows = await this.activityService.findAll({
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId ?? undefined,
            systemId:
              typeof input.systemId === 'string' ? input.systemId : undefined,
          });
          const limit =
            typeof input.limit === 'number' && input.limit > 0
              ? Math.min(Math.floor(input.limit), 100)
              : 30;
          const trimmed = rows.slice(0, limit);
          return {
            output: trimmed.map((a) => ({
              id: a.id,
              action: a.action,
              targetType: a.targetType,
              targetId: a.targetId,
              origin: a.origin,
              createdAt: a.createdAt,
            })),
            summary: `${trimmed.length} recent activity entr${trimmed.length === 1 ? 'y' : 'ies'}.`,
          };
        },
      ),
    ];
  }
}
