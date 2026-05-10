import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { AI_ORCHESTRATION_QUEUE } from '../jobs/jobs.constants';
import { AiJobDispatcherService } from './ai-job-dispatcher.service';

@Injectable()
@Processor(AI_ORCHESTRATION_QUEUE)
export class AiProcessor extends WorkerHost {
  constructor(private readonly dispatcher: AiJobDispatcherService) {
    super();
  }

  async process(job: Job<{ backgroundJobId: string }>) {
    return this.dispatcher.runJob(job.data.backgroundJobId);
  }
}
