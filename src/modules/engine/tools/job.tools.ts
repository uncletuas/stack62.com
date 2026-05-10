import { Injectable } from '@nestjs/common';
import { JobsService } from '../../coworker/jobs.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class JobTools {
  constructor(private readonly jobsService: JobsService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'jobs.list',
        'List jobs assigned to the coworker (recurring and one-shot work the coworker handles).',
        {
          properties: {
            status: {
              type: 'string',
              enum: [
                'pending',
                'scheduled',
                'running',
                'completed',
                'failed',
                'paused',
                'cancelled',
              ],
            },
            systemId: { type: 'string' },
          },
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) throw new Error('workspaceId required.');
          const rows = await this.jobsService.list(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
              status:
                typeof input.status === 'string' ? input.status : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((j) => ({
              id: j.id,
              title: j.title,
              status: j.status,
              triggerType: j.triggerType,
              triggerConfig: j.triggerConfig,
              nextRunAt: j.nextRunAt,
              lastRunAt: j.lastRunAt,
              autopilot: j.autopilot,
              runCount: j.runCount,
            })),
            summary: `${rows.length} job${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'jobs.create',
        'Assign the coworker a new job. Use for any recurring or scheduled work the user wants done automatically. `instructions` is the plain-English description of what to do each time the job fires; the coworker executes it with full tool access. For recurring schedules use triggerType="schedule" with triggerConfig.rrule (FREQ=DAILY/WEEKLY/MONTHLY/HOURLY/MINUTELY with optional INTERVAL). For one-shot use runAt (ISO-8601). Manual jobs run only when triggered.',
        {
          properties: {
            title: { type: 'string' },
            instructions: {
              type: 'string',
              description:
                'What the coworker should do each time the job runs.',
            },
            triggerType: {
              type: 'string',
              enum: ['manual', 'schedule', 'event'],
            },
            triggerConfig: {
              type: 'object',
              properties: {
                runAt: { type: 'string', description: 'ISO-8601 one-shot time.' },
                rrule: { type: 'string', description: 'RFC5545 RRULE.' },
              },
            },
            autopilot: {
              type: 'boolean',
              description:
                'When true (default), the coworker executes without confirmation each run.',
            },
            systemId: { type: 'string' },
          },
          required: ['title', 'instructions'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) throw new Error('workspaceId required.');
          const tcRaw = input.triggerConfig;
          const tc =
            tcRaw && typeof tcRaw === 'object'
              ? (tcRaw as { runAt?: string; rrule?: string })
              : undefined;
          const job = await this.jobsService.create(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId:
                typeof input.systemId === 'string'
                  ? input.systemId
                  : ctx.systemId ?? undefined,
              title: String(input.title),
              instructions: String(input.instructions),
              triggerType:
                (input.triggerType as 'manual' | 'schedule' | 'event') ??
                'manual',
              triggerConfig: tc
                ? { runAt: tc.runAt ?? null, rrule: tc.rrule ?? null }
                : undefined,
              autopilot: input.autopilot !== false,
            },
            ctx.actorUserId,
          );
          return {
            output: {
              id: job.id,
              title: job.title,
              status: job.status,
              triggerType: job.triggerType,
              nextRunAt: job.nextRunAt,
            },
            summary: `Job "${job.title}" created${
              job.triggerType === 'schedule' && job.nextRunAt
                ? ` — next run ${new Date(job.nextRunAt).toLocaleString()}`
                : '.'
            }`,
          };
        },
      ),
      tool(
        'jobs.run',
        'Run a job once now (in addition to its schedule).',
        {
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
        async (input, ctx) => {
          await this.jobsService.triggerNow(String(input.jobId), ctx.actorUserId);
          return {
            output: { ok: true },
            summary: `Job scheduled for immediate run.`,
          };
        },
      ),
      tool(
        'jobs.pause',
        'Pause a recurring job — stops future runs until resumed.',
        {
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
        async (input, ctx) => {
          const j = await this.jobsService.pause(
            String(input.jobId),
            ctx.actorUserId,
          );
          return { output: { id: j.id, status: j.status }, summary: `Paused.` };
        },
      ),
      tool(
        'jobs.resume',
        'Resume a paused job.',
        {
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
        async (input, ctx) => {
          const j = await this.jobsService.resume(
            String(input.jobId),
            ctx.actorUserId,
          );
          return { output: { id: j.id, status: j.status }, summary: `Resumed.` };
        },
      ),
      tool(
        'jobs.cancel',
        'Cancel a job permanently.',
        {
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
        async (input, ctx) => {
          const j = await this.jobsService.cancel(
            String(input.jobId),
            ctx.actorUserId,
          );
          return {
            output: { id: j.id, status: j.status },
            summary: `Cancelled.`,
          };
        },
      ),
      tool(
        'jobs.runs',
        'Read the recent execution history of a job.',
        {
          properties: { jobId: { type: 'string' } },
          required: ['jobId'],
        },
        async (input, ctx) => {
          const runs = await this.jobsService.listRuns(
            String(input.jobId),
            ctx.actorUserId,
          );
          return {
            output: runs.map((r) => ({
              id: r.id,
              status: r.status,
              triggeredBy: r.triggeredBy,
              startedAt: r.startedAt,
              completedAt: r.completedAt,
              summary: r.summary,
              errorMessage: r.errorMessage,
              steps: r.steps?.length ?? 0,
            })),
            summary: `${runs.length} run${runs.length === 1 ? '' : 's'}.`,
          };
        },
      ),
    ];
  }
}
