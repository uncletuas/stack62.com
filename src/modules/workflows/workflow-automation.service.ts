import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import type { EngineService } from '../engine/engine.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { WorkflowDefinitionEntity } from './entities/workflow-definition.entity';
import {
  WorkflowRunEntity,
  WorkflowRunHistoryEntry,
} from './entities/workflow-run.entity';
import {
  getStepEscalationAt,
  getStepMaxRetries,
  getStepNextRunAt,
  getStepRetryDelay,
  getWorkflowStep,
  resolveNextStepKey,
} from './workflow-runtime.util';

@Injectable()
export class WorkflowAutomationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkflowAutomationService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly workflowsRepository: Repository<WorkflowDefinitionEntity>,
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRunsRepository: Repository<WorkflowRunEntity>,
    private readonly configService: ConfigService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
    private readonly integrationsService: IntegrationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async getEngineService(): Promise<EngineService> {
    // Resolve EngineService lazily across the module tree to avoid a static
    // circular import between WorkflowsModule and EngineModule. The class
    // reference is loaded at runtime via require so the type-only import
    // above stays type-only.

    const {
      EngineService: EngineServiceClass,
    } = require('../engine/engine.service');
    return this.moduleRef.get<EngineService>(EngineServiceClass, {
      strict: false,
    });
  }

  onModuleInit() {
    if (!this.configService.get<boolean>('WORKFLOW_AUTOMATION_ENABLED', true)) {
      this.logger.log('Workflow automation scanner disabled.');
      return;
    }

    const intervalMs = this.configService.get<number>(
      'WORKFLOW_AUTOMATION_INTERVAL_MS',
      15000,
    );
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `Workflow automation tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(limit = 25) {
    const dueRuns = await this.workflowRunsRepository.find({
      where: {
        status: 'active',
        nextRunAt: LessThanOrEqual(new Date()),
      },
      order: { nextRunAt: 'ASC' },
      take: limit,
    });

    for (const run of dueRuns) {
      await this.processRun(run);
    }

    await this.escalateOverdueRuns(limit);
    return { processed: dueRuns.length };
  }

  private async processRun(run: WorkflowRunEntity) {
    const workflow = await this.workflowsRepository.findOne({
      where: { id: run.workflowDefinitionId },
    });
    if (!workflow) {
      await this.failRun(run, 'Workflow definition no longer exists.');
      return;
    }

    const step = getWorkflowStep(workflow.definition, run.currentStepKey);
    if (!step) {
      await this.failRun(run, 'Current workflow step no longer exists.');
      return;
    }

    try {
      switch (step.type) {
        case 'timer':
        case 'delay':
          await this.advanceAutomatically(run, workflow, 'timer_elapsed');
          break;
        case 'notification':
          await this.dispatchNotification(run, step.config ?? {});
          await this.advanceAutomatically(run, workflow, 'notification_sent');
          break;
        case 'webhook':
          await this.callWebhook(step.config ?? {});
          await this.advanceAutomatically(run, workflow, 'webhook_sent');
          break;
        case 'approval':
        case 'user_task':
          run.nextRunAt = null;
          await this.workflowRunsRepository.save(run);
          break;
        case 'coworker_task':
          await this.runCoworkerTask(run, workflow, step.config ?? {});
          break;
        default:
          await this.advanceAutomatically(run, workflow, 'auto_advance');
      }
    } catch (error) {
      await this.retryOrFail(run, step, error);
    }
  }

  private async advanceAutomatically(
    run: WorkflowRunEntity,
    workflow: WorkflowDefinitionEntity,
    action: string,
  ) {
    const nextStepKey = resolveNextStepKey({
      action: 'advance',
      definition: workflow.definition,
      currentStepKey: run.currentStepKey,
    });
    const nextStep = getWorkflowStep(workflow.definition, nextStepKey);
    const historyEntry: WorkflowRunHistoryEntry = {
      at: new Date().toISOString(),
      actorUserId: run.startedByUserId,
      fromStepKey: run.currentStepKey,
      toStepKey: nextStepKey,
      action,
      metadata: { automated: true },
    };

    run.currentStepKey = nextStepKey;
    run.status = nextStepKey ? 'active' : 'completed';
    run.history = [...(run.history ?? []), historyEntry];
    run.nextRunAt = nextStepKey ? getStepNextRunAt(nextStep) : null;
    run.retryCount = 0;
    run.maxRetries = getStepMaxRetries(nextStep);
    run.escalationAt = nextStepKey ? getStepEscalationAt(nextStep) : null;
    run.lastError = null;
    run.completedAt = nextStepKey ? null : new Date();

    const saved = await this.workflowRunsRepository.save(run);
    await this.activityService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      systemId: saved.systemId,
      actorUserId: saved.startedByUserId,
      action: `workflow_run.${action}`,
      targetType: 'workflow_run',
      targetId: saved.id,
      origin: 'system',
      metadata: { toStepKey: nextStepKey, status: saved.status },
    });
  }

  private async dispatchNotification(
    run: WorkflowRunEntity,
    config: Record<string, unknown>,
  ) {
    const channel = this.configString(config.channel, 'in_app');
    const message = this.configString(config.message, 'Workflow notification');
    if (channel === 'email') {
      const to = Array.isArray(config.to)
        ? config.to.filter((item): item is string => typeof item === 'string')
        : typeof config.to === 'string'
          ? [config.to]
          : [];
      if (to.length > 0) {
        await this.integrationsService.sendEmail(
          {
            organizationId: run.organizationId,
            workspaceId: run.workspaceId ?? undefined,
            to,
            subject: this.configString(
              config.subject,
              'Stack62 workflow notification',
            ),
            text: message,
            html: typeof config.html === 'string' ? config.html : undefined,
            metadata: {
              workflowRunId: run.id,
              currentStepKey: run.currentStepKey,
            },
          },
          run.startedByUserId,
        );
        return;
      }
    }

    if (channel === 'whatsapp' && typeof config.to === 'string') {
      await this.integrationsService.sendWhatsApp(
        {
          organizationId: run.organizationId,
          workspaceId: run.workspaceId ?? undefined,
          to: config.to,
          message,
          metadata: {
            workflowRunId: run.id,
            currentStepKey: run.currentStepKey,
          },
        },
        run.startedByUserId,
      );
      return;
    }

    await this.activityService.log({
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      systemId: run.systemId,
      actorUserId: run.startedByUserId,
      action: 'workflow_notification.dispatch',
      targetType: 'workflow_run',
      targetId: run.id,
      origin: 'system',
      metadata: {
        channel,
        message,
      },
    });
  }

  private async callWebhook(config: Record<string, unknown>) {
    const url = typeof config.url === 'string' ? config.url : '';
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Webhook step requires an http(s) URL.');
    }

    const method = typeof config.method === 'string' ? config.method : 'POST';
    const body = config.body ?? {};
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method.toUpperCase() === 'GET' ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`);
    }
  }

  private configString(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : fallback;
  }

  /**
   * Runs an `EngineService` session as the Coworker for the workspace, using
   * the step's `instructions`. Engine attaches the Coworker actor and gates
   * tools by its role (see EngineService + EngineRuntimeService). Captures
   * the assistant's final text into history and advances the run.
   */
  private async runCoworkerTask(
    run: WorkflowRunEntity,
    workflow: WorkflowDefinitionEntity,
    config: Record<string, unknown>,
  ) {
    const instructions = this.configString(
      config.instructions,
      `Perform step "${run.currentStepKey ?? '?'}" of workflow "${workflow.name}".`,
    );
    if (!run.workspaceId) {
      // Without a workspace we have no Coworker context — fail loudly.
      await this.failRun(run, 'coworker_task step requires a workspace.');
      return;
    }

    const engineService = await this.getEngineService();
    let lastMessage = '';
    let errorMessage: string | null = null;
    const iterator = engineService.run({
      ctx: {
        organizationId: run.organizationId,
        workspaceId: run.workspaceId,
        systemId: run.systemId,
        actorUserId: run.startedByUserId,
      },
      prompt: instructions,
      autopilot:
        typeof config.autopilot === 'boolean' ? config.autopilot : true,
    });
    for await (const event of iterator) {
      if (event.type === 'message.complete' && typeof event.text === 'string') {
        lastMessage = event.text;
      } else if (event.type === 'session.error') {
        errorMessage = event.message ?? 'Coworker session failed.';
      }
    }
    if (errorMessage) throw new Error(errorMessage);

    const nextStepKey = resolveNextStepKey({
      action: 'advance',
      definition: workflow.definition,
      currentStepKey: run.currentStepKey,
    });
    const nextStep = getWorkflowStep(workflow.definition, nextStepKey);
    const historyEntry: WorkflowRunHistoryEntry = {
      at: new Date().toISOString(),
      actorUserId: run.startedByUserId,
      fromStepKey: run.currentStepKey,
      toStepKey: nextStepKey,
      action: 'coworker_task',
      note: lastMessage ? lastMessage.slice(0, 280) : null,
      metadata: { automated: true, actor: 'coworker' },
    };

    run.currentStepKey = nextStepKey;
    run.status = nextStepKey ? 'active' : 'completed';
    run.history = [...(run.history ?? []), historyEntry];
    run.nextRunAt = nextStepKey ? getStepNextRunAt(nextStep) : null;
    run.retryCount = 0;
    run.maxRetries = getStepMaxRetries(nextStep);
    run.escalationAt = nextStepKey ? getStepEscalationAt(nextStep) : null;
    run.lastError = null;
    run.completedAt = nextStepKey ? null : new Date();
    const saved = await this.workflowRunsRepository.save(run);

    await this.activityService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      systemId: saved.systemId,
      actorUserId: saved.startedByUserId,
      action: 'workflow_run.coworker_task',
      targetType: 'workflow_run',
      targetId: saved.id,
      origin: 'ai',
      metadata: { toStepKey: nextStepKey, status: saved.status },
    });
  }

  private async retryOrFail(
    run: WorkflowRunEntity,
    step: { retry?: { retryDelaySeconds?: number } },
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    run.retryCount += 1;
    run.lastError = message;

    if (run.retryCount <= run.maxRetries) {
      run.nextRunAt = new Date(Date.now() + getStepRetryDelay(step) * 1000);
      await this.workflowRunsRepository.save(run);
      return;
    }

    await this.failRun(run, message);
  }

  private async failRun(run: WorkflowRunEntity, message: string) {
    const beforeData = { ...run };
    run.status = 'failed';
    run.lastError = message;
    run.nextRunAt = null;
    run.completedAt = new Date();
    run.history = [
      ...(run.history ?? []),
      {
        at: new Date().toISOString(),
        actorUserId: run.startedByUserId,
        fromStepKey: run.currentStepKey,
        toStepKey: null,
        action: 'fail',
        note: message,
        metadata: { automated: true },
      },
    ];
    const saved = await this.workflowRunsRepository.save(run);
    await this.auditService.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      systemId: saved.systemId,
      actorUserId: saved.startedByUserId,
      action: 'workflow_run.fail',
      targetType: 'workflow_run',
      targetId: saved.id,
      origin: 'system',
      beforeData,
      afterData: saved,
    });
  }

  private async escalateOverdueRuns(limit: number) {
    const overdue = await this.workflowRunsRepository.find({
      where: {
        status: 'active',
        escalationAt: LessThanOrEqual(new Date()),
      },
      take: limit,
    });

    for (const run of overdue) {
      await this.activityService.log({
        organizationId: run.organizationId,
        workspaceId: run.workspaceId,
        systemId: run.systemId,
        actorUserId: run.startedByUserId,
        action: 'workflow_run.escalate',
        targetType: 'workflow_run',
        targetId: run.id,
        origin: 'system',
        metadata: {
          currentStepKey: run.currentStepKey,
          escalationAt: run.escalationAt?.toISOString() ?? null,
        },
      });
      run.escalationAt = null;
      await this.workflowRunsRepository.save(run);
    }
  }
}
