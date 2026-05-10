import { Injectable, Logger } from '@nestjs/common';
import type { JobRunEntity } from './entities/job-run.entity';
import { JobRunnerService } from './job-runner.service';
import { JobsService } from './jobs.service';

@Injectable()
export class JobDispatcherService {
  private readonly logger = new Logger(JobDispatcherService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly jobsService: JobsService,
    private readonly runner: JobRunnerService,
  ) {}

  async dispatchNow(jobId: string, actorUserId: string): Promise<boolean> {
    const job = await this.jobsService.triggerNow(jobId, actorUserId);
    return this.dispatchInternal(job.id, 'manual');
  }

  dispatchInternal(
    jobId: string,
    triggeredBy: JobRunEntity['triggeredBy'],
  ): boolean {
    if (this.running.has(jobId)) return false;
    this.running.add(jobId);

    void this.runner
      .runJob(jobId, triggeredBy)
      .catch((err: unknown) => {
        this.logger.error(
          `Job ${jobId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        this.running.delete(jobId);
      });

    return true;
  }
}
