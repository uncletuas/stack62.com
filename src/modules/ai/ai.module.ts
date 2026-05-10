import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SystemsModule } from '../systems/systems.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AiController } from './ai.controller';
import { AiImpactService } from './ai-impact.service';
import { AiJobDispatcherService } from './ai-job-dispatcher.service';
import { AiPlannerService } from './ai-planner.service';
import { AiService } from './ai.service';
import { AiChangePlanEntity } from './entities/ai-change-plan.entity';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';
import { AiGeneratedArtifactEntity } from './entities/ai-generated-artifact.entity';
import { AiRequestLogEntity } from './entities/ai-request-log.entity';
import { AiValidationResultEntity } from './entities/ai-validation-result.entity';
import { ClaudeCodeService } from './claude-code.service';
import { CodexService } from './codex.service';
import { OpenRouterService } from './openrouter.service';
import { AiGatewayService } from './ai-gateway.service';
import { ModelRouterService } from './model-router.service';
import { StudioArtifactService } from './studio-artifact.service';
import { StudioEngineService } from './studio-engine.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiChangeRequestEntity,
      AiChangePlanEntity,
      AiGeneratedArtifactEntity,
      AiRequestLogEntity,
      AiValidationResultEntity,
    ]),
    JobsModule,
    OrganizationsModule,
    SystemsModule,
    WorkflowsModule,
    PermissionsModule,
    ActivityModule,
    AuditModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    AiImpactService,
    AiJobDispatcherService,
    AiPlannerService,
    ClaudeCodeService,
    CodexService,
    OpenRouterService,
    AiGatewayService,
    ModelRouterService,
    StudioArtifactService,
    StudioEngineService,
  ],
  exports: [
    AiService,
    AiImpactService,
    AiPlannerService,
    ClaudeCodeService,
    CodexService,
    OpenRouterService,
    AiGatewayService,
    ModelRouterService,
    StudioArtifactService,
    StudioEngineService,
    AiJobDispatcherService,
    TypeOrmModule,
  ],
})
export class AiModule {}
