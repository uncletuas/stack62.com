import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { EngineModule } from '../engine/engine.module';
import { CoworkerController } from './coworker.controller';
import { CoworkerChatService } from './coworker-chat.service';
import { CoworkerMemoryService } from './coworker-memory.service';
import { CoworkerService } from './coworker.service';
import { CoworkerMemoryEntity } from './entities/coworker-memory.entity';
import { CoworkerMessageEntity } from './entities/coworker-message.entity';
import { CoworkerEntity } from './entities/coworker.entity';
import { JobRunEntity } from './entities/job-run.entity';
import { JobEntity } from './entities/job.entity';
import { WhatsAppAgentConfigEntity } from './entities/whatsapp-agent-config.entity';
import { EmailAgentConfigEntity } from './entities/email-agent-config.entity';
import { JobDispatcherService } from './job-dispatcher.service';
import { JobRunnerService } from './job-runner.service';
import { JobSchedulerService } from './job-scheduler.service';
import { JobsService } from './jobs.service';
import { WhatsAppAgentService } from './whatsapp-agent.service';
import { EmailAgentService } from './email-agent.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoworkerEntity,
      CoworkerMessageEntity,
      CoworkerMemoryEntity,
      JobEntity,
      JobRunEntity,
      WhatsAppAgentConfigEntity,
      EmailAgentConfigEntity,
    ]),
    ActivityModule,
    forwardRef(() => EngineModule),
  ],
  controllers: [CoworkerController],
  providers: [
    CoworkerService,
    CoworkerChatService,
    CoworkerMemoryService,
    JobsService,
    JobRunnerService,
    JobDispatcherService,
    JobSchedulerService,
    WhatsAppAgentService,
    EmailAgentService,
  ],
  exports: [
    CoworkerService,
    CoworkerChatService,
    CoworkerMemoryService,
    JobsService,
    JobDispatcherService,
    WhatsAppAgentService,
    EmailAgentService,
  ],
})
export class CoworkerModule {}
