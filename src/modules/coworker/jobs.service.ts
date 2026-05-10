import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import {
  CreateJobDto,
  CreateReminderJobDto,
  CreateWeeklyReportJobDto,
  UpdateJobDto,
} from './dto/create-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { JobEntity, type JobTriggerConfig } from './entities/job.entity';
import { JobRunEntity } from './entities/job-run.entity';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(JobEntity)
    private readonly jobRepo: Repository<JobEntity>,
    @InjectRepository(JobRunEntity)
    private readonly runRepo: Repository<JobRunEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  async create(dto: CreateJobDto, actorUserId: string): Promise<JobEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
    });

    const triggerType = dto.triggerType ?? 'manual';
    const triggerConfig: JobTriggerConfig | null = dto.triggerConfig
      ? {
          runAt: dto.triggerConfig.runAt ?? null,
          rrule: dto.triggerConfig.rrule ?? null,
          eventName: dto.triggerConfig.eventName ?? null,
        }
      : null;
    const nextRunAt = computeNextRun(triggerType, triggerConfig, null);

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        organizationId: dto.organizationId,
        workspaceId: dto.workspaceId,
        systemId: dto.systemId ?? null,
        createdByUserId: actorUserId,
        title: dto.title,
        instructions: dto.instructions,
        triggerType,
        triggerConfig,
        autopilot: dto.autopilot ?? true,
        status: triggerType === 'manual' ? 'pending' : 'scheduled',
        nextRunAt,
      }),
    );

    await this.activity.log({
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
      actorUserId,
      action: 'job.create',
      targetType: 'job',
      targetId: job.id,
      origin: 'user',
      metadata: { title: job.title, triggerType: job.triggerType },
    });

    if (job.triggerType === 'schedule') await this.scheduleNextRun(job);
    return job;
  }

  async createWeeklyReport(
    dto: CreateWeeklyReportJobDto,
    actorUserId: string,
  ): Promise<JobEntity> {
    const day = dto.dayOfWeek ?? 'FR';
    const hour = dto.hour ?? 9;
    const minute = dto.minute ?? 0;
    const sourceType = dto.sourceType ?? 'mixed';
    const title = dto.title ?? 'Weekly operations report';
    return this.create(
      {
        organizationId: dto.organizationId,
        workspaceId: dto.workspaceId,
        systemId: dto.systemId,
        title,
        instructions:
          `Generate a ${sourceType} weekly operations report for this workspace. ` +
          'Use current tasks, records, schedules, and activity where available. ' +
          'Create a report, save it as a document, and write a concise activity summary.',
        triggerType: 'schedule',
        triggerConfig: {
          rrule: `FREQ=WEEKLY;BYDAY=${day};BYHOUR=${hour};BYMINUTE=${minute}`,
        },
        autopilot: true,
      },
      actorUserId,
    );
  }

  async createReminder(
    dto: CreateReminderJobDto,
    actorUserId: string,
  ): Promise<JobEntity> {
    if (!dto.runAt && !dto.rrule) {
      throw new BadRequestException('Provide either runAt or rrule.');
    }
    return this.create(
      {
        organizationId: dto.organizationId,
        workspaceId: dto.workspaceId,
        systemId: dto.systemId,
        title: dto.title,
        instructions:
          `${dto.instructions}\n\nCreate or update reminders/tasks as needed, ` +
          'and log what was done in the workspace activity stream.',
        triggerType: 'schedule',
        triggerConfig: {
          runAt: dto.runAt ?? null,
          rrule: dto.rrule ?? null,
        },
        autopilot: true,
      },
      actorUserId,
    );
  }

  async list(filters: ListJobsDto, actorUserId: string): Promise<JobEntity[]> {
    const qb = this.jobRepo.createQueryBuilder('job');
    await this.accessControl.applyTenantScopeToQueryBuilder(
      qb,
      'job',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );
    if (filters.systemId) {
      qb.andWhere('job.systemId = :systemId', { systemId: filters.systemId });
    }
    if (filters.status) {
      qb.andWhere('job.status = :status', { status: filters.status });
    }
    return qb.orderBy('job.createdAt', 'DESC').getMany();
  }

  async findOne(jobId: string, actorUserId: string): Promise<JobEntity> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found.');
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
    });
    return job;
  }

  async update(
    jobId: string,
    dto: UpdateJobDto,
    actorUserId: string,
  ): Promise<JobEntity> {
    const job = await this.findOne(jobId, actorUserId);
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
    });

    if (dto.title !== undefined) job.title = dto.title;
    if (dto.instructions !== undefined) job.instructions = dto.instructions;
    if (dto.triggerType !== undefined) job.triggerType = dto.triggerType;
    if (dto.triggerConfig !== undefined) {
      job.triggerConfig = {
        runAt: dto.triggerConfig.runAt ?? null,
        rrule: dto.triggerConfig.rrule ?? null,
        eventName: dto.triggerConfig.eventName ?? null,
      };
    }
    if (dto.autopilot !== undefined) job.autopilot = dto.autopilot;
    if (dto.status !== undefined) {
      job.status = dto.status;
      if (dto.status === 'paused') job.pausedAt = new Date();
      if (dto.status === 'scheduled' || dto.status === 'pending') {
        job.pausedAt = null;
      }
    }

    job.nextRunAt = computeNextRun(
      job.triggerType,
      job.triggerConfig,
      job.lastRunAt,
    );
    const saved = await this.jobRepo.save(job);
    if (saved.triggerType === 'schedule' && saved.status !== 'paused') {
      await this.scheduleNextRun(saved);
    }
    return saved;
  }

  async cancel(jobId: string, actorUserId: string): Promise<JobEntity> {
    const job = await this.findOne(jobId, actorUserId);
    job.status = 'cancelled';
    job.nextRunAt = null;
    return this.jobRepo.save(job);
  }

  async pause(jobId: string, actorUserId: string): Promise<JobEntity> {
    return this.update(jobId, { status: 'paused' }, actorUserId);
  }

  async resume(jobId: string, actorUserId: string): Promise<JobEntity> {
    return this.update(jobId, { status: 'scheduled' }, actorUserId);
  }

  async listRuns(jobId: string, actorUserId: string): Promise<JobRunEntity[]> {
    await this.findOne(jobId, actorUserId);
    return this.runRepo.find({
      where: { jobId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async triggerNow(jobId: string, actorUserId: string): Promise<JobEntity> {
    const job = await this.findOne(jobId, actorUserId);
    if (job.status === 'paused' || job.status === 'cancelled') {
      throw new BadRequestException(
        `Job is ${job.status}; resume it before running.`,
      );
    }
    job.status = 'scheduled';
    job.nextRunAt = new Date();
    job.pausedAt = null;
    return this.jobRepo.save(job);
  }

  async scheduleNextRun(job: JobEntity): Promise<void> {
    if (!job.nextRunAt) return;
    this.logger.log(
      `Scheduled job ${job.id} for ${job.nextRunAt.toISOString()}`,
    );
  }

  async findDueScheduledJobs(limit = 10): Promise<JobEntity[]> {
    return this.jobRepo.find({
      where: {
        status: 'scheduled',
        nextRunAt: LessThanOrEqual(new Date()),
      },
      order: { nextRunAt: 'ASC' },
      take: limit,
    });
  }

  async loadInternal(jobId: string): Promise<JobEntity | null> {
    return this.jobRepo.findOne({ where: { id: jobId } });
  }

  async saveInternal(job: JobEntity): Promise<JobEntity> {
    return this.jobRepo.save(job);
  }

  async createRun(
    job: JobEntity,
    triggeredBy: JobRunEntity['triggeredBy'],
  ): Promise<JobRunEntity> {
    return this.runRepo.save(
      this.runRepo.create({
        jobId: job.id,
        organizationId: job.organizationId,
        workspaceId: job.workspaceId,
        status: 'running',
        triggeredBy,
        startedAt: new Date(),
        steps: [],
      }),
    );
  }

  async updateRun(run: JobRunEntity): Promise<JobRunEntity> {
    return this.runRepo.save(run);
  }

  async rescheduleOpenJobs(): Promise<number> {
    return this.jobRepo
      .createQueryBuilder('job')
      .where('job.status = :status', { status: 'scheduled' })
      .andWhere('job.nextRunAt IS NOT NULL')
      .getCount();
  }
}

function computeNextRun(
  triggerType: string,
  cfg: JobTriggerConfig | null,
  lastRunAt: Date | null,
): Date | null {
  if (triggerType !== 'schedule' || !cfg) return null;
  const now = Date.now();

  if (cfg.rrule) {
    const next = nextFromRrule(cfg.rrule, lastRunAt ?? new Date());
    if (next) return next;
  }

  if (cfg.runAt) {
    const at = new Date(cfg.runAt).getTime();
    if (Number.isFinite(at) && at > now) return new Date(at);
    if (lastRunAt) return null;
    if (Number.isFinite(at)) return new Date(Math.max(now + 1000, at));
  }
  return null;
}

function nextFromRrule(rrule: string, anchor: Date): Date | null {
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
