import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { AI_ORCHESTRATION_QUEUE } from './jobs.constants';
import { BackgroundJobEntity } from './entities/background-job.entity';
import { ListBackgroundJobsDto } from './dto/list-background-jobs.dto';
import { LocalJobRunnerService } from './local-job-runner.service';

export interface EnqueueBackgroundJobInput {
  organizationId?: string | null;
  workspaceId?: string | null;
  systemId?: string | null;
  actorUserId?: string | null;
  queueName: string;
  jobType: string;
  input?: Record<string, unknown> | null;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(BackgroundJobEntity)
    private readonly jobsRepository: Repository<BackgroundJobEntity>,
    @InjectQueue(AI_ORCHESTRATION_QUEUE)
    private readonly aiQueue: Queue,
    private readonly accessControlService: AccessControlService,
    private readonly localJobRunner: LocalJobRunnerService,
  ) {}

  async enqueue(input: EnqueueBackgroundJobInput) {
    const job = this.jobsRepository.create({
      organizationId: input.organizationId ?? null,
      workspaceId: input.workspaceId ?? null,
      systemId: input.systemId ?? null,
      actorUserId: input.actorUserId ?? null,
      queueName: input.queueName,
      jobType: input.jobType,
      bullJobId: null,
      status: 'queued',
      progress: 0,
      input: input.input ?? null,
      output: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    });

    const createdJob = await this.jobsRepository.save(job);

    if (input.queueName === AI_ORCHESTRATION_QUEUE) {
      try {
        const bullJob = await this.aiQueue.add(input.jobType, {
          backgroundJobId: createdJob.id,
        });
        createdJob.bullJobId = String(bullJob.id);
        await this.jobsRepository.save(createdJob);
      } catch (err) {
        this.logger.warn(
          `BullMQ unavailable (${err instanceof Error ? err.message : String(err)}); falling back to local runner.`,
        );
        this.localJobRunner.dispatch(input.queueName, createdJob.id);
      }
    }

    return createdJob;
  }

  async markProcessing(jobId: string, progress = 10) {
    const job = await this.findOne(jobId);
    if (job.status === 'cancelled') return job;
    job.status = 'processing';
    job.progress = progress;
    job.startedAt = job.startedAt ?? new Date();
    return this.jobsRepository.save(job);
  }

  async updateProgress(
    jobId: string,
    progress: number,
    output?: Record<string, unknown>,
  ) {
    const job = await this.findOne(jobId);
    job.progress = progress;
    if (output) {
      job.output = {
        ...(job.output ?? {}),
        ...output,
      };
    }
    return this.jobsRepository.save(job);
  }

  async markCompleted(jobId: string, output?: Record<string, unknown>) {
    const job = await this.findOne(jobId);
    job.status = 'completed';
    job.progress = 100;
    job.output = output ?? job.output;
    job.completedAt = new Date();
    return this.jobsRepository.save(job);
  }

  async markFailed(jobId: string, errorMessage: string) {
    const job = await this.findOne(jobId);
    job.status = 'failed';
    job.errorMessage = errorMessage;
    job.completedAt = new Date();
    return this.jobsRepository.save(job);
  }

  async cancel(jobId: string) {
    const job = await this.findOne(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    job.status = 'cancelled';
    job.progress = 100;
    job.completedAt = new Date();
    job.errorMessage = 'Operation stopped by user.';
    return this.jobsRepository.save(job);
  }

  async findAll(filters: ListBackgroundJobsDto, actorUserId: string) {
    const queryBuilder = this.jobsRepository.createQueryBuilder('job');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
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
      queryBuilder.andWhere('job.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.queueName) {
      queryBuilder.andWhere('job.queueName = :queueName', {
        queueName: filters.queueName,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('job.status = :status', { status: filters.status });
    }

    return queryBuilder.orderBy('job.createdAt', 'DESC').take(200).getMany();
  }

  async findOne(jobId: string) {
    const job = await this.jobsRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Background job not found.');
    }

    return job;
  }
}
