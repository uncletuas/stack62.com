import { Injectable, Logger } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { EngineService } from '../engine/engine.service';
import { CoworkerService } from './coworker.service';
import type { JobEntity } from './entities/job.entity';
import type { JobRunStep } from './entities/job-run.entity';
import { JobsService } from './jobs.service';

/**
 * Executes a coworker job by streaming the engine to completion using the
 * job's instructions as the prompt. Records every tool call/result.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly engineService: EngineService,
    private readonly coworkerService: CoworkerService,
    private readonly activityService: ActivityService,
  ) {}

  async runJob(
    jobId: string,
    triggeredBy: 'manual' | 'schedule' | 'event',
  ): Promise<void> {
    const job = await this.jobsService.loadInternal(jobId);
    if (!job) {
      this.logger.warn(`runJob: job ${jobId} not found`);
      return;
    }
    if (job.status === 'paused' || job.status === 'cancelled') {
      this.logger.log(`runJob: skipping ${job.status} job ${jobId}`);
      return;
    }

    const coworker = await this.coworkerService.getOrCreate(
      job.organizationId,
      job.workspaceId,
      job.createdByUserId,
    );

    job.status = 'running';
    await this.jobsService.saveInternal(job);
    const run = await this.jobsService.createRun(job, triggeredBy);

    this.logger.log(
      `Running job ${job.id} ("${job.title}") triggered by ${triggeredBy}`,
    );

    const steps: JobRunStep[] = [];
    let summary = '';
    let lastError: string | null = null;

    try {
      const stream = this.engineService.run({
        ctx: {
          organizationId: job.organizationId,
          workspaceId: job.workspaceId,
          systemId: job.systemId ?? null,
          actorUserId: job.createdByUserId,
        },
        prompt: job.instructions,
        systemHint: this.coworkerService.buildSystemPreamble(
          coworker,
          job.autopilot,
        ) +
          `\n\nThis is an automated job run titled "${job.title}". Complete the work fully — do not ask follow-up questions; act with the permissions you have. If something blocks you, finish with a clear note explaining what's missing.`,
        model: coworker.model ?? undefined,
        maxTurns: 12,
      });
      for await (const ev of stream) {
        switch (ev.type) {
          case 'tool.call':
            steps.push({
              type: 'tool_call',
              name: ev.name,
              input: ev.input,
              ts: new Date().toISOString(),
            });
            break;
          case 'tool.result':
            steps.push({
              type: 'tool_result',
              name: ev.name,
              ok: ev.ok,
              output: ev.output,
              text: ev.summary,
              ts: new Date().toISOString(),
            });
            break;
          case 'message.complete':
            steps.push({
              type: 'message',
              text: ev.text,
              ts: new Date().toISOString(),
            });
            summary = ev.text || summary;
            break;
          case 'session.error':
            lastError = ev.message;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    run.steps = steps;
    run.summary = summary || null;
    run.errorMessage = lastError;
    run.status = lastError ? 'failed' : 'succeeded';
    run.completedAt = new Date();
    await this.jobsService.updateRun(run);

    job.lastRunAt = new Date();
    job.runCount = (job.runCount ?? 0) + 1;
    job.lastError = lastError;
    if (lastError) {
      job.status = job.triggerType === 'schedule' ? 'scheduled' : 'failed';
    } else if (job.triggerType === 'manual') {
      job.status = 'completed';
    } else {
      job.status = 'scheduled';
    }
    // Recompute next-run for recurring jobs.
    if (job.triggerType === 'schedule') {
      job.nextRunAt = nextFromRrule(
        job.triggerConfig?.rrule ?? null,
        job.lastRunAt,
      );
      if (job.nextRunAt) {
        await this.jobsService.scheduleNextRun(job);
      } else {
        job.status = 'completed';
      }
    } else {
      job.nextRunAt = null;
    }
    await this.jobsService.saveInternal(job);

    await this.activityService.log({
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
      actorUserId: job.createdByUserId,
      action: lastError ? 'job.run.failed' : 'job.run.succeeded',
      targetType: 'job',
      targetId: job.id,
      origin: 'ai',
      metadata: {
        runId: run.id,
        triggeredBy,
        title: job.title,
        steps: steps.length,
        error: lastError,
      },
    });
  }
}

function nextFromRrule(rrule: string | null, anchor: Date): Date | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(
    rrule
      .split(';')
      .map((s) => s.split('='))
      .filter((p) => p.length === 2),
  ) as Record<string, string>;
  const freq = (parts.FREQ ?? '').toUpperCase();
  const interval = Math.max(1, Number(parts.INTERVAL ?? '1'));
  const base = anchor.getTime();
  switch (freq) {
    case 'MINUTELY':
      return new Date(base + interval * 60 * 1000);
    case 'HOURLY':
      return new Date(base + interval * 60 * 60 * 1000);
    case 'DAILY':
      return new Date(base + interval * 24 * 60 * 60 * 1000);
    case 'WEEKLY':
      return nextWeekly(parts, anchor, interval);
    case 'MONTHLY': {
      const d = new Date(base);
      d.setMonth(d.getMonth() + interval);
      return d;
    }
    default:
      return null;
  }
}

const WEEKDAYS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function nextWeekly(
  parts: Record<string, string>,
  anchor: Date,
  interval: number,
) {
  const byDay = parts.BYDAY ? WEEKDAYS[parts.BYDAY.toUpperCase()] : undefined;
  if (byDay === undefined) {
    return new Date(anchor.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
  }
  const next = new Date(anchor);
  next.setSeconds(0, 0);
  next.setHours(
    Number(parts.BYHOUR ?? next.getHours()),
    Number(parts.BYMINUTE ?? next.getMinutes()),
    0,
    0,
  );
  let diff = (byDay - next.getDay() + 7) % 7;
  if (diff === 0 && next.getTime() <= anchor.getTime()) diff = 7 * interval;
  next.setDate(next.getDate() + diff);
  return next;
}
