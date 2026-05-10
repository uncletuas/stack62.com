import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../../shared/utils/slugify';
import { AdvanceWorkflowRunDto } from './dto/advance-workflow-run.dto';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { ListWorkflowDefinitionsDto } from './dto/list-workflow-definitions.dto';
import { ListWorkflowRunsDto } from './dto/list-workflow-runs.dto';
import { StartWorkflowRunDto } from './dto/start-workflow-run.dto';
import { WorkflowDefinitionEntity } from './entities/workflow-definition.entity';
import {
  WorkflowRunEntity,
  WorkflowRunHistoryEntry,
  WorkflowRunStatus,
} from './entities/workflow-run.entity';
import {
  getStartStepKey,
  getStepEscalationAt,
  getStepMaxRetries,
  getStepNextRunAt,
  getWorkflowStep,
  resolveNextStepKey,
} from './workflow-runtime.util';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly workflowsRepository: Repository<WorkflowDefinitionEntity>,
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRunsRepository: Repository<WorkflowRunEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreateWorkflowDefinitionDto, actorUserId: string) {
    const workflow = this.workflowsRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
      systemVersionId: payload.systemVersionId ?? null,
      moduleDefinitionId: payload.moduleDefinitionId ?? null,
      createdByUserId: actorUserId,
      name: payload.name,
      key: payload.key ?? slugify(payload.name),
      triggerType: payload.triggerType,
      definition: payload.definition,
      status: 'draft',
    });

    const createdWorkflow = await this.workflowsRepository.save(workflow);

    await this.activityService.log({
      organizationId: createdWorkflow.organizationId,
      workspaceId: createdWorkflow.workspaceId,
      systemId: createdWorkflow.systemId,
      actorUserId,
      action: 'workflow_definition.create',
      targetType: 'workflow_definition',
      targetId: createdWorkflow.id,
      origin: 'user',
      metadata: {
        key: createdWorkflow.key,
        triggerType: createdWorkflow.triggerType,
      },
    });

    await this.auditService.log({
      organizationId: createdWorkflow.organizationId,
      workspaceId: createdWorkflow.workspaceId,
      systemId: createdWorkflow.systemId,
      actorUserId,
      action: 'workflow_definition.create',
      targetType: 'workflow_definition',
      targetId: createdWorkflow.id,
      afterData: createdWorkflow,
    });

    return createdWorkflow;
  }

  async findAll(filters: ListWorkflowDefinitionsDto, actorUserId: string) {
    const queryBuilder =
      this.workflowsRepository.createQueryBuilder('workflow');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'workflow',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('workflow.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    return queryBuilder.orderBy('workflow.createdAt', 'DESC').getMany();
  }

  async startRun(payload: StartWorkflowRunDto, actorUserId: string) {
    const workflow = await this.workflowsRepository.findOne({
      where: { id: payload.workflowDefinitionId },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow definition not found.');
    }

    if (
      workflow.organizationId !== payload.organizationId ||
      workflow.workspaceId !== payload.workspaceId ||
      workflow.systemId !== payload.systemId
    ) {
      throw new BadRequestException(
        'Workflow definition does not belong to the requested tenant scope.',
      );
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'workflow_definition',
      action: 'manage_workflows',
      organizationId: workflow.organizationId,
      workspaceId: workflow.workspaceId,
      systemId: workflow.systemId,
    });

    const startStepKey = getStartStepKey(workflow.definition);
    const startStep = getWorkflowStep(workflow.definition, startStepKey);
    const initialStatus: WorkflowRunStatus = startStepKey
      ? 'active'
      : 'completed';
    const history: WorkflowRunHistoryEntry[] = [
      {
        at: new Date().toISOString(),
        actorUserId,
        fromStepKey: null,
        toStepKey: startStepKey,
        action: 'start',
        metadata: { triggerType: workflow.triggerType },
      },
    ];

    const run = await this.workflowRunsRepository.save(
      this.workflowRunsRepository.create({
        organizationId: workflow.organizationId,
        workspaceId: workflow.workspaceId,
        systemId: workflow.systemId,
        workflowDefinitionId: workflow.id,
        recordId: payload.recordId ?? null,
        startedByUserId: actorUserId,
        currentStepKey: startStepKey,
        status: initialStatus,
        context: payload.context ?? null,
        history,
        nextRunAt:
          initialStatus === 'active' ? getStepNextRunAt(startStep) : null,
        retryCount: 0,
        maxRetries: getStepMaxRetries(startStep),
        escalationAt:
          initialStatus === 'active' ? getStepEscalationAt(startStep) : null,
        lastError: null,
        completedAt: initialStatus === 'completed' ? new Date() : null,
      }),
    );

    await this.activityService.log({
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      systemId: run.systemId,
      actorUserId,
      action: 'workflow_run.start',
      targetType: 'workflow_run',
      targetId: run.id,
      origin: 'user',
      metadata: {
        workflowDefinitionId: workflow.id,
        currentStepKey: run.currentStepKey,
      },
    });

    await this.auditService.log({
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      systemId: run.systemId,
      actorUserId,
      action: 'workflow_run.start',
      targetType: 'workflow_run',
      targetId: run.id,
      afterData: run,
    });

    return run;
  }

  async findRuns(filters: ListWorkflowRunsDto, actorUserId: string) {
    const queryBuilder = this.workflowRunsRepository.createQueryBuilder('run');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'run',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('run.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }
    if (filters.workflowDefinitionId) {
      queryBuilder.andWhere(
        'run.workflowDefinitionId = :workflowDefinitionId',
        { workflowDefinitionId: filters.workflowDefinitionId },
      );
    }
    if (filters.recordId) {
      queryBuilder.andWhere('run.recordId = :recordId', {
        recordId: filters.recordId,
      });
    }
    if (filters.status) {
      queryBuilder.andWhere('run.status = :status', {
        status: filters.status,
      });
    }

    return queryBuilder.orderBy('run.createdAt', 'DESC').take(200).getMany();
  }

  async findRun(runId: string, actorUserId: string) {
    const run = await this.workflowRunsRepository.findOne({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Workflow run not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'workflow_definition',
      action: 'read',
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      systemId: run.systemId,
    });

    return run;
  }

  async advanceRun(
    runId: string,
    payload: AdvanceWorkflowRunDto,
    actorUserId: string,
  ) {
    const run = await this.workflowRunsRepository.findOne({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException('Workflow run not found.');
    }

    if (run.status !== 'active') {
      throw new BadRequestException('Only active workflow runs can advance.');
    }

    const workflow = await this.workflowsRepository.findOne({
      where: { id: run.workflowDefinitionId },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow definition not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'workflow_definition',
      action: 'manage_workflows',
      organizationId: run.organizationId,
      workspaceId: run.workspaceId,
      systemId: run.systemId,
    });

    const beforeData = { ...run };
    const nextStepKey = resolveNextStepKey({
      action: payload.action,
      definition: workflow.definition,
      currentStepKey: run.currentStepKey,
      requestedNextStepKey: payload.nextStepKey,
    });

    const nextStatus = this.resolveRunStatus(payload.action, nextStepKey);
    const nextStep = getWorkflowStep(workflow.definition, nextStepKey);
    const historyEntry: WorkflowRunHistoryEntry = {
      at: new Date().toISOString(),
      actorUserId,
      fromStepKey: run.currentStepKey,
      toStepKey: nextStepKey,
      action: payload.action,
      note: payload.note ?? null,
      metadata: payload.metadata ?? null,
    };

    run.currentStepKey = nextStepKey;
    run.status = nextStatus;
    run.history = [...(run.history ?? []), historyEntry];
    run.nextRunAt = nextStatus === 'active' ? getStepNextRunAt(nextStep) : null;
    run.retryCount = 0;
    run.maxRetries = getStepMaxRetries(nextStep);
    run.escalationAt =
      nextStatus === 'active' ? getStepEscalationAt(nextStep) : null;
    run.lastError = null;
    run.completedAt = nextStatus === 'active' ? null : new Date();

    const updatedRun = await this.workflowRunsRepository.save(run);

    await this.activityService.log({
      organizationId: updatedRun.organizationId,
      workspaceId: updatedRun.workspaceId,
      systemId: updatedRun.systemId,
      actorUserId,
      action: `workflow_run.${payload.action}`,
      targetType: 'workflow_run',
      targetId: updatedRun.id,
      origin: 'user',
      metadata: {
        workflowDefinitionId: updatedRun.workflowDefinitionId,
        fromStepKey: historyEntry.fromStepKey,
        toStepKey: historyEntry.toStepKey,
        status: updatedRun.status,
      },
    });

    await this.auditService.log({
      organizationId: updatedRun.organizationId,
      workspaceId: updatedRun.workspaceId,
      systemId: updatedRun.systemId,
      actorUserId,
      action: `workflow_run.${payload.action}`,
      targetType: 'workflow_run',
      targetId: updatedRun.id,
      beforeData,
      afterData: updatedRun,
    });

    return updatedRun;
  }

  private resolveRunStatus(
    action: AdvanceWorkflowRunDto['action'],
    nextStepKey: string | null,
  ): WorkflowRunStatus {
    if (action === 'cancel') return 'cancelled';
    if (action === 'fail') return 'failed';
    if (action === 'complete') return 'completed';
    return nextStepKey ? 'active' : 'completed';
  }
}
