import { Injectable } from '@nestjs/common';
import { SchedulesService } from '../../schedules/schedules.service';
import { TasksService } from '../../tasks/tasks.service';
import { WorkflowsService } from '../../workflows/workflows.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class AutomationTools {
  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly workflowsService: WorkflowsService,
    private readonly tasksService: TasksService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'schedules.list',
        'List schedules (meetings, deadlines, milestones, recurring tasks).',
        {
          properties: {
            systemId: { type: 'string' },
            status: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const rows = await this.schedulesService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
              status:
                typeof input.status === 'string' ? input.status : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((s) => ({
              id: s.id,
              title: s.title,
              kind: s.kind,
              status: s.status,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              recurrenceRule: s.recurrenceRule,
            })),
            summary: `${rows.length} schedule${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'schedules.create',
        'Create a schedule entry. Times must be ISO-8601.',
        {
          properties: {
            title: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'meeting',
                'milestone',
                'deadline',
                'task',
                'shift',
                'reminder',
              ],
            },
            startsAt: { type: 'string', description: 'ISO-8601 timestamp.' },
            endsAt: { type: 'string' },
            recurrenceRule: { type: 'string', description: 'Optional RFC5545 RRULE.' },
            metadata: { type: 'object' },
          },
          required: ['title', 'kind', 'startsAt'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new Error('workspaceId is required for schedules.');
          const sched = await this.schedulesService.create(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: ctx.systemId ?? undefined,
              title: String(input.title),
              kind: String(input.kind),
              startsAt: new Date(String(input.startsAt)),
              endsAt:
                typeof input.endsAt === 'string'
                  ? new Date(input.endsAt)
                  : undefined,
              recurrenceRule:
                typeof input.recurrenceRule === 'string'
                  ? input.recurrenceRule
                  : undefined,
              metadata: (input.metadata ?? {}) as Record<string, unknown>,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: sched.id, title: sched.title, startsAt: sched.startsAt },
            summary: `Scheduled "${sched.title}".`,
          };
        },
      ),
      tool(
        'workflows.list',
        'List workflow definitions for a system.',
        {
          properties: {
            systemId: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const rows = await this.workflowsService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((w) => ({
              id: w.id,
              name: w.name,
              triggerType: w.triggerType,
              status: w.status,
            })),
            summary: `${rows.length} workflow${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'workflows.start',
        'Start a workflow run for a specific record.',
        {
          properties: {
            workflowDefinitionId: { type: 'string' },
            systemId: { type: 'string' },
            recordId: { type: 'string' },
            context: { type: 'object' },
          },
          required: ['workflowDefinitionId', 'systemId'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new Error('workspaceId is required to start a workflow.');
          const run = await this.workflowsService.startRun(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: String(input.systemId),
              workflowDefinitionId: String(input.workflowDefinitionId),
              recordId:
                typeof input.recordId === 'string' ? input.recordId : undefined,
              context: (input.context ?? {}) as Record<string, unknown>,
            },
            ctx.actorUserId,
          );
          return {
            output: {
              id: run.id,
              status: run.status,
              currentStepKey: run.currentStepKey,
            },
            summary: `Workflow run ${run.id.slice(0, 8)} ${run.status}.`,
          };
        },
      ),
      tool(
        'workflows.advance',
        'Advance an active workflow run with an action.',
        {
          properties: {
            runId: { type: 'string' },
            action: {
              type: 'string',
              enum: [
                'advance',
                'approve',
                'reject',
                'complete',
                'cancel',
                'fail',
              ],
            },
            note: { type: 'string' },
          },
          required: ['runId', 'action'],
        },
        async (input, ctx) => {
          const run = await this.workflowsService.advanceRun(
            String(input.runId),
            {
              action: input.action as
                | 'advance'
                | 'approve'
                | 'reject'
                | 'complete'
                | 'cancel'
                | 'fail',
              note: typeof input.note === 'string' ? input.note : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: run.id, status: run.status },
            summary: `Run ${input.action} → ${run.status}.`,
          };
        },
      ),
      tool(
        'tasks.list',
        'List tasks in this workspace, optionally filtered by status or assignee.',
        {
          properties: {
            status: { type: 'string' },
            assigneeUserId: { type: 'string' },
            systemId: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const rows = await this.tasksService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
              status:
                typeof input.status === 'string' ? input.status : undefined,
              assigneeUserId:
                typeof input.assigneeUserId === 'string'
                  ? input.assigneeUserId
                  : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              dueAt: t.dueAt,
              assigneeUserId: t.assigneeUserId,
            })),
            summary: `${rows.length} task${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'tasks.create',
        'Create a task. Optionally assign and set due date.',
        {
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'urgent'],
            },
            dueAt: { type: 'string', description: 'ISO-8601.' },
            assigneeUserId: { type: 'string' },
            systemId: { type: 'string' },
          },
          required: ['title'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new Error('workspaceId is required for tasks.');
          const t = await this.tasksService.create(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId:
                typeof input.systemId === 'string'
                  ? input.systemId
                  : ctx.systemId ?? undefined,
              title: String(input.title),
              description:
                typeof input.description === 'string'
                  ? input.description
                  : undefined,
              priority:
                typeof input.priority === 'string'
                  ? input.priority
                  : 'normal',
              dueAt:
                typeof input.dueAt === 'string'
                  ? new Date(input.dueAt)
                  : undefined,
              assigneeUserId:
                typeof input.assigneeUserId === 'string'
                  ? input.assigneeUserId
                  : ctx.actorUserId,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: t.id, title: t.title, status: t.status },
            summary: `Task created: "${t.title}".`,
          };
        },
      ),
      tool(
        'tasks.update',
        'Update a task (status, priority, due date, assignee).',
        {
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            dueAt: { type: 'string' },
            assigneeUserId: { type: 'string' },
          },
          required: ['taskId'],
        },
        async (input, ctx) => {
          const t = await this.tasksService.update(
            String(input.taskId),
            {
              status:
                typeof input.status === 'string' ? input.status : undefined,
              priority:
                typeof input.priority === 'string' ? input.priority : undefined,
              dueAt:
                typeof input.dueAt === 'string'
                  ? new Date(input.dueAt)
                  : undefined,
              assigneeUserId:
                typeof input.assigneeUserId === 'string'
                  ? input.assigneeUserId
                  : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: t.id, status: t.status },
            summary: `Task ${t.status}.`,
          };
        },
      ),
    ];
  }
}
