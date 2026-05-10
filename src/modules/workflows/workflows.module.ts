import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WorkflowDefinitionEntity } from './entities/workflow-definition.entity';
import { WorkflowRunEntity } from './entities/workflow-run.entity';
import { WorkflowAutomationService } from './workflow-automation.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkflowDefinitionEntity, WorkflowRunEntity]),
    ActivityModule,
    AuditModule,
    IntegrationsModule,
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowAutomationService],
  exports: [WorkflowsService, WorkflowAutomationService],
})
export class WorkflowsModule {}
