import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AI_ORCHESTRATION_QUEUE } from './jobs.constants';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { LocalJobRunnerService } from './local-job-runner.service';
import { BackgroundJobEntity } from './entities/background-job.entity';

@Module({
  imports: [
    BullModule.registerQueue({
      name: AI_ORCHESTRATION_QUEUE,
    }),
    TypeOrmModule.forFeature([BackgroundJobEntity]),
  ],
  controllers: [JobsController],
  providers: [JobsService, LocalJobRunnerService],
  exports: [JobsService, LocalJobRunnerService, BullModule],
})
export class JobsModule {}
