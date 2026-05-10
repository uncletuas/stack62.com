import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '../jobs/jobs.module';
import { AiProcessor } from './ai.processor';
import { AiModule } from './ai.module';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiChangeRequestEntity]),
    JobsModule,
    AiModule,
  ],
  providers: [AiProcessor],
})
export class AiWorkerModule {}
