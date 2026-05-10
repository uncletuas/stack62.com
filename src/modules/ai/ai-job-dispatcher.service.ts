import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AI_ORCHESTRATION_QUEUE } from '../jobs/jobs.constants';
import { JobsService } from '../jobs/jobs.service';
import { LocalJobRunnerService } from '../jobs/local-job-runner.service';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';
import { AiService } from './ai.service';
import { StudioEngineService } from './studio-engine.service';

@Injectable()
export class AiJobDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(AiJobDispatcherService.name);

  constructor(
    @InjectRepository(AiChangeRequestEntity)
    private readonly requestsRepository: Repository<AiChangeRequestEntity>,
    private readonly jobsService: JobsService,
    private readonly localJobRunner: LocalJobRunnerService,
    private readonly aiService: AiService,
    private readonly studioEngineService: StudioEngineService,
  ) {}

  onModuleInit() {
    this.localJobRunner.register(AI_ORCHESTRATION_QUEUE, (id) =>
      this.runJob(id),
    );
    this.logger.log('Registered local AI job handler.');
  }

  async runJob(backgroundJobId: string) {
    const started = await this.jobsService.markProcessing(backgroundJobId, 10);
    if (started.status === 'cancelled') return;

    const request = await this.requestsRepository.findOne({
      where: { backgroundJobId },
    });

    if (!request) {
      await this.jobsService.markFailed(
        backgroundJobId,
        'AI change request not found.',
      );
      return;
    }

    try {
      await this.aiService.updateRequestStatus(request.id, 'planning');
      await this.throwIfCancelled(backgroundJobId, request.id);
      await this.aiService.appendProgressStep(
        request.id,
        'info',
        'Received prompt - checking AI provider availability...',
      );

      await this.aiService.appendProgressStep(
        request.id,
        'info',
        'Sending prompt to AI model...',
      );
      const { plan, resolvedModel } =
        await this.studioEngineService.generatePlanForRequest(request);
      await this.throwIfCancelled(backgroundJobId, request.id);

      await this.aiService.appendProgressStep(
        request.id,
        'success',
        `Plan received from ${resolvedModel} - ${plan.modules.length} module(s), risk: ${plan.riskLevel}`,
        {
          resolvedModel,
          riskLevel: plan.riskLevel,
          modules: plan.modules.map((m) => ({
            name: m.name,
            key: m.key,
            entities: m.entities.map((e) => ({
              name: e.name,
              key: e.key,
              fieldCount: e.fields.length,
              fields: e.fields.map((f) => ({
                name: f.name,
                dataType: f.dataType,
                required: f.required ?? false,
              })),
            })),
          })),
        },
      );

      await this.jobsService.updateProgress(backgroundJobId, 55, {
        intent: plan.intent,
        riskLevel: plan.riskLevel,
      });

      await this.aiService.appendProgressStep(
        request.id,
        'info',
        'Validating generated schema...',
      );
      const validated = this.studioEngineService.validatePlan(plan);
      const savedPlan = await this.aiService.savePlan(request.id, plan);
      await this.aiService.saveValidation(
        request.id,
        savedPlan.id,
        validated.isValid,
        validated.issues,
        validated.warnings,
      );

      if (!validated.isValid) {
        const issueText = validated.issues.join('; ');
        await this.aiService.appendProgressStep(
          request.id,
          'error',
          `Schema validation failed: ${issueText}`,
          { issues: validated.issues },
        );
        await this.aiService.updateRequestStatus(request.id, 'failed', {
          intent: plan.intent,
          riskLevel: plan.riskLevel,
          summary: `Validation failed: ${issueText}`,
        });
        await this.jobsService.markCompleted(backgroundJobId, {
          requestId: request.id,
          status: 'failed',
          issues: validated.issues,
        });
        return;
      }

      const entityCount = plan.modules.reduce(
        (n, m) => n + m.entities.length,
        0,
      );
      await this.aiService.appendProgressStep(
        request.id,
        'success',
        `Schema valid - ${plan.modules.length} module(s), ${entityCount} entit${entityCount !== 1 ? 'ies' : 'y'}, ${plan.riskLevel} risk`,
      );
      await this.jobsService.updateProgress(backgroundJobId, 70, {
        intent: plan.intent,
        riskLevel: plan.riskLevel,
      });

      if (request.generateArtifacts) {
        await this.aiService.appendProgressStep(
          request.id,
          'info',
          'Generating definition artifacts...',
        );
      }
      const generatedArtifacts =
        await this.studioEngineService.generateArtifactsForRequest(
          request,
          savedPlan.id,
          plan,
        );
      if (generatedArtifacts.length > 0) {
        await this.aiService.appendProgressStep(
          request.id,
          'success',
          `${generatedArtifacts.length} artifact(s) generated`,
        );
      }
      await this.jobsService.updateProgress(backgroundJobId, 85, {
        requestId: request.id,
        artifactCount: generatedArtifacts.length,
      });
      await this.throwIfCancelled(backgroundJobId, request.id);

      await this.aiService.appendProgressStep(
        request.id,
        'info',
        'Applying validated changes...',
      );
      await this.jobsService.updateProgress(backgroundJobId, 90, {
        requestId: request.id,
        autoApply: true,
      });
      const applyResult = await this.aiService.applyRequest(
        request.id,
        request.actorUserId,
      );
      await this.aiService.appendProgressStep(
        request.id,
        'success',
        'Changes applied.',
      );
      await this.jobsService.markCompleted(backgroundJobId, {
        requestId: request.id,
        status: 'applied',
        applyResult,
        artifactCount: generatedArtifacts.length,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown AI job failure.';
      if (errorMessage === 'Operation stopped by user.') {
        await this.aiService
          .appendProgressStep(request.id, 'info', errorMessage)
          .catch(() => null);
        return;
      }
      this.logger.error(`AI job ${backgroundJobId} failed: ${errorMessage}`);
      await this.aiService
        .appendProgressStep(request.id, 'error', errorMessage)
        .catch(() => null);
      await this.aiService.updateRequestStatus(request.id, 'failed', {
        summary: errorMessage,
      });
      await this.jobsService.markFailed(backgroundJobId, errorMessage);
    }
  }

  private async throwIfCancelled(backgroundJobId: string, requestId: string) {
    const job = await this.jobsService.findOne(backgroundJobId);
    if (job.status !== 'cancelled') return;
    await this.aiService.updateRequestStatus(requestId, 'rejected', {
      summary: 'Operation stopped by user.',
    });
    throw new Error('Operation stopped by user.');
  }
}
