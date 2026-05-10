import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { JobDispatcherService } from './job-dispatcher.service';
import { JobsService } from './jobs.service';

@Injectable()
export class JobSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly jobsService: JobsService,
    private readonly dispatcher: JobDispatcherService,
  ) {}

  async onModuleInit() {
    const count = await this.jobsService.rescheduleOpenJobs();
    if (count) {
      this.logger.log(`${count} scheduled coworker job(s) ready to execute.`);
    }
    this.timer = setInterval(() => void this.tick(), 15_000);
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const dueJobs = await this.jobsService.findDueScheduledJobs(10);
      for (const job of dueJobs) {
        this.dispatcher.dispatchInternal(job.id, 'schedule');
      }
    } catch (err) {
      this.logger.error(
        `Coworker scheduler tick failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.ticking = false;
    }
  }
}
