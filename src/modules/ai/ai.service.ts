import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { AI_ORCHESTRATION_QUEUE } from '../jobs/jobs.constants';
import { PermissionsService } from '../permissions/permissions.service';
import { SystemsService } from '../systems/systems.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { slugify } from '../../shared/utils/slugify';
import {
  EntityDefinition,
  FieldDefinition,
  ModuleDefinition,
  PermissionPolicyDefinition,
  SystemDefinition,
  WorkflowDefinition,
  applyDiffSelection,
  diffSystemDefinition,
  emptySystemDefinition,
  isFieldDataType,
} from '../../shared/system-definition';
import { AiImpactService, DiffImpactReport } from './ai-impact.service';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { CreateAiChangeRequestDto } from './dto/create-ai-change-request.dto';
import { ListAiChangeRequestsDto } from './dto/list-ai-change-requests.dto';
import { AiChangePlanEntity } from './entities/ai-change-plan.entity';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';
import { AiGeneratedArtifactEntity } from './entities/ai-generated-artifact.entity';
import { AiValidationResultEntity } from './entities/ai-validation-result.entity';
import { AiChangePlan } from './schemas/change-plan.schema';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(AiChangeRequestEntity)
    private readonly requestsRepository: Repository<AiChangeRequestEntity>,
    @InjectRepository(AiChangePlanEntity)
    private readonly plansRepository: Repository<AiChangePlanEntity>,
    @InjectRepository(AiValidationResultEntity)
    private readonly validationsRepository: Repository<AiValidationResultEntity>,
    @InjectRepository(AiGeneratedArtifactEntity)
    private readonly artifactsRepository: Repository<AiGeneratedArtifactEntity>,
    private readonly jobsService: JobsService,
    private readonly systemsService: SystemsService,
    private readonly workflowsService: WorkflowsService,
    private readonly permissionsService: PermissionsService,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly impactService: AiImpactService,
  ) {}

  async createRequest(payload: CreateAiChangeRequestDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'ai_change_request',
      action: 'manage_ai',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const request = this.requestsRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId ?? null,
      actorUserId,
      backgroundJobId: null,
      prompt: payload.prompt,
      intent: null,
      status: 'queued',
      riskLevel: null,
      autoApply: payload.autoApply ?? true,
      generateArtifacts: payload.generateArtifacts ?? false,
      summary: null,
      appliedSystemId: null,
      metadata:
        Object.keys(payload.context ?? {}).length || payload.model
          ? {
              ...(payload.context ?? {}),
              ...(payload.model ? { _model: payload.model } : {}),
            }
          : null,
    });

    const createdRequest = await this.requestsRepository.save(request);
    const backgroundJob = await this.jobsService.enqueue({
      organizationId: createdRequest.organizationId,
      workspaceId: createdRequest.workspaceId,
      systemId: createdRequest.systemId,
      actorUserId,
      queueName: AI_ORCHESTRATION_QUEUE,
      jobType: 'ai-change-request',
      input: {
        requestId: createdRequest.id,
      },
    });

    createdRequest.backgroundJobId = backgroundJob.id;
    const updatedRequest = await this.requestsRepository.save(createdRequest);

    await this.activityService.log({
      organizationId: updatedRequest.organizationId,
      workspaceId: updatedRequest.workspaceId,
      systemId: updatedRequest.systemId,
      actorUserId,
      action: 'ai_change_request.create',
      targetType: 'ai_change_request',
      targetId: updatedRequest.id,
      origin: 'ai',
      metadata: { backgroundJobId: backgroundJob.id },
    });

    await this.auditService.log({
      organizationId: updatedRequest.organizationId,
      workspaceId: updatedRequest.workspaceId,
      systemId: updatedRequest.systemId,
      actorUserId,
      action: 'ai_change_request.create',
      targetType: 'ai_change_request',
      targetId: updatedRequest.id,
      afterData: updatedRequest,
    });

    return {
      request: updatedRequest,
      backgroundJob,
    };
  }

  async findAll(filters: ListAiChangeRequestsDto, actorUserId: string) {
    const queryBuilder = this.requestsRepository.createQueryBuilder('request');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'request',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('request.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('request.status = :status', {
        status: filters.status,
      });
    }

    return queryBuilder.orderBy('request.createdAt', 'DESC').getMany();
  }

  async findOne(requestId: string) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    const plans = await this.plansRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });

    const validations = await this.validationsRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });

    const artifacts = await this.artifactsRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });

    return {
      ...request,
      plans,
      validations,
      artifacts,
    };
  }

  async findArtifacts(requestId: string) {
    return this.artifactsRepository.find({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
  }

  async savePlan(requestId: string, plan: AiChangePlan) {
    const savedPlan = await this.plansRepository.save(
      this.plansRepository.create({
        requestId,
        planType: plan.intent,
        structuredPlan: plan,
        summary: plan.summary,
        riskLevel: plan.riskLevel,
        status: 'generated',
      }),
    );

    return savedPlan;
  }

  async saveValidation(
    requestId: string,
    planId: string,
    isValid: boolean,
    issues: string[],
    warnings: string[],
  ) {
    return this.validationsRepository.save(
      this.validationsRepository.create({
        requestId,
        planId,
        isValid,
        issues,
        warnings,
        metadata: null,
      }),
    );
  }

  async updateRequestStatus(
    requestId: string,
    status: string,
    updates?: Partial<AiChangeRequestEntity>,
  ) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    Object.assign(request, updates ?? {});
    request.status = status;
    return this.requestsRepository.save(request);
  }

  async appendProgressStep(
    requestId: string,
    type: 'info' | 'success' | 'error' | 'code',
    message: string,
    data?: Record<string, unknown>,
  ) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) return;
    const existing = Array.isArray(request.metadata?.steps)
      ? (request.metadata.steps as Array<Record<string, unknown>>)
      : [];
    const step: Record<string, unknown> = {
      ts: new Date().toISOString(),
      type,
      message,
    };
    if (data !== undefined) step.data = data;
    request.metadata = { ...request.metadata, steps: [...existing, step] };
    await this.requestsRepository.save(request);
  }

  async applyRequest(
    requestId: string,
    actorUserId: string,
    selection?: { changeIds?: string[] } | null,
  ) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'ai_change_request',
      action: 'apply_ai',
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      systemId: request.systemId,
      ownerUserId: request.actorUserId,
    });

    const plan = await this.plansRepository.findOne({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
    const validation = await this.validationsRepository.findOne({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });

    if (!plan || !validation?.isValid) {
      throw new UnprocessableEntityException(
        'AI change request does not have a valid structured plan to apply.',
      );
    }

    const structuredPlan = plan.structuredPlan as AiChangePlan;
    const isPartial =
      Array.isArray(selection?.changeIds) && selection!.changeIds!.length > 0;

    const before: SystemDefinition = request.systemId
      ? await this.systemsService.getPublishedDefinition(request.systemId)
      : emptySystemDefinition();
    const fullAfter = this.buildAfterDefinition(structuredPlan, before);

    let effectiveAfter: SystemDefinition;
    if (isPartial) {
      const fullDiff = diffSystemDefinition(before, fullAfter);
      const selectedIds = new Set(selection!.changeIds!);
      effectiveAfter = applyDiffSelection(
        before,
        fullAfter,
        fullDiff,
        selectedIds,
      );
    } else {
      effectiveAfter = fullAfter;
    }

    if (structuredPlan.intent === 'create_system') {
      const created = await this.systemsService.create(
        {
          organizationId: request.organizationId,
          workspaceId: request.workspaceId,
          name: effectiveAfter.name,
          description: effectiveAfter.description ?? undefined,
          industryType: effectiveAfter.industryType ?? undefined,
          governanceMode: effectiveAfter.governanceMode,
          visibility: effectiveAfter.visibility,
          sourcePrompt: request.prompt,
          modules: effectiveAfter.modules.map((module) => ({
            name: module.name,
            key: module.key,
            description: module.description ?? undefined,
            kind: module.kind,
            config: module.config ?? undefined,
            entities: module.entities.map((entity) => ({
              name: entity.name,
              key: entity.key,
              description: entity.description ?? undefined,
              config: entity.config ?? undefined,
              fields: entity.fields.map((field) => ({
                name: field.name,
                key: field.key,
                dataType: field.dataType,
                required: field.required,
                config: field.config ?? undefined,
              })),
            })),
          })),
          views: effectiveAfter.views.map((view) => ({
            name: view.name,
            type: view.type as
              | 'table'
              | 'form'
              | 'kanban'
              | 'calendar'
              | 'chart'
              | 'card',
            config: view.config ?? undefined,
          })),
          dashboards: effectiveAfter.dashboards.map((dashboard) => ({
            name: dashboard.name,
            scope: dashboard.scope,
            widgets: dashboard.widgets,
          })),
        },
        actorUserId,
      );

      const published = await this.systemsService.publish(
        created.system.id,
        {
          versionId: created.version.id,
          changeSummary: structuredPlan.summary,
        },
        actorUserId,
      );

      await this.createSupportingDefinitionsFromDefinition(
        {
          organizationId: request.organizationId,
          workspaceId: request.workspaceId,
          systemId: published.system.id,
          systemVersionId: published.version.id,
        },
        effectiveAfter,
        actorUserId,
      );

      await this.updateRequestStatus(requestId, 'applied', {
        appliedSystemId: published.system.id,
        summary: structuredPlan.summary,
        metadata: {
          ...(request.metadata ?? {}),
          ...(isPartial
            ? { partialApproval: { changeIds: selection!.changeIds } }
            : {}),
        },
      });

      return {
        requestId,
        appliedSystemId: published.system.id,
        versionId: published.version.id,
        partial: isPartial,
      };
    }

    const draftVersion = await this.systemsService.createDraftVersion(
      request.systemId!,
      actorUserId,
      structuredPlan.summary,
      effectiveAfter as unknown as Record<string, unknown>,
      request.prompt,
    );

    await this.updateRequestStatus(requestId, 'applied', {
      appliedSystemId: request.systemId,
      summary: structuredPlan.summary,
      metadata: {
        ...(request.metadata ?? {}),
        ...(isPartial
          ? { partialApproval: { changeIds: selection!.changeIds } }
          : {}),
      },
    });

    return {
      requestId,
      draftVersionId: draftVersion.id,
      appliedSystemId: request.systemId,
      partial: isPartial,
    };
  }

  async computeImpact(requestId: string): Promise<{
    requestId: string;
    impact: DiffImpactReport;
  }> {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }
    const diffResult = await this.computeDiff(requestId);
    const impact = await this.impactService.computeImpact(
      request.systemId,
      diffResult.diff,
    );
    return { requestId, impact };
  }

  async computeDiff(requestId: string) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    const plan = await this.plansRepository.findOne({
      where: { requestId },
      order: { createdAt: 'DESC' },
    });
    if (!plan) {
      throw new UnprocessableEntityException(
        'AI change request has no generated plan yet.',
      );
    }

    const structuredPlan = plan.structuredPlan as AiChangePlan;

    const before: SystemDefinition = request.systemId
      ? await this.systemsService.getPublishedDefinition(request.systemId)
      : emptySystemDefinition();

    const after = this.buildAfterDefinition(structuredPlan, before);
    const diff = diffSystemDefinition(before, after);

    return {
      requestId,
      planId: plan.id,
      riskLevel: diff.riskLevel,
      riskScore: diff.riskScore,
      before,
      after,
      diff,
    };
  }

  async rejectRequest(requestId: string, actorUserId: string, reason?: string) {
    const request = await this.requestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'ai_change_request',
      action: 'apply_ai',
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      systemId: request.systemId,
      ownerUserId: request.actorUserId,
    });

    const nextMetadata = {
      ...(request.metadata ?? {}),
      rejection: {
        reason: reason ?? null,
        rejectedAt: new Date().toISOString(),
        rejectedByUserId: actorUserId,
      },
    };

    const updated = await this.updateRequestStatus(requestId, 'rejected', {
      metadata: nextMetadata,
    });

    await this.activityService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'ai_change_request.reject',
      targetType: 'ai_change_request',
      targetId: updated.id,
      origin: 'user',
      metadata: { reason: reason ?? null },
    });

    await this.auditService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'ai_change_request.reject',
      targetType: 'ai_change_request',
      targetId: updated.id,
      afterData: { status: updated.status, reason: reason ?? null },
    });

    return updated;
  }

  private buildAfterDefinition(
    plan: AiChangePlan,
    before: SystemDefinition,
  ): SystemDefinition {
    const planModules = plan.modules.map((module) => this.toModule(module));
    const planViews = plan.views.map((view) => ({
      name: view.name,
      type: this.toViewType(view.type),
      entityKey: view.entityKey ?? null,
      config: view.config ?? null,
    }));
    const planDashboards = plan.dashboards.map((dashboard) => ({
      name: dashboard.name,
      scope: dashboard.scope,
      widgets: dashboard.widgets,
    }));
    const planWorkflows: WorkflowDefinition[] = plan.workflows.map((wf) => ({
      name: wf.name,
      key: wf.key ?? null,
      triggerType: wf.triggerType,
      moduleKey: wf.moduleKey ?? null,
      definition: wf.definition ?? {},
    }));
    const planPolicies: PermissionPolicyDefinition[] =
      plan.permissionPolicies.map((policy) => ({
        name: policy.name,
        scope: policy.scope,
        role: policy.role,
        resourceType: policy.resourceType,
        actions: policy.actions,
        fieldRestrictions: policy.fieldRestrictions ?? null,
        conditions: policy.conditions ?? null,
      }));

    if (plan.intent === 'create_system') {
      return {
        name: plan.name,
        purpose: null,
        description: plan.description ?? null,
        teamSize: null,
        industryType: plan.industryType ?? null,
        governanceMode: plan.governanceMode,
        visibility: plan.visibility,
        modules: planModules,
        views: planViews,
        dashboards: planDashboards,
        workflows: planWorkflows,
        permissionPolicies: planPolicies,
      };
    }

    const mergedModules = this.mergeModules(before.modules, planModules);
    const mergedWorkflows = this.mergeByKey(
      before.workflows,
      planWorkflows,
      (w) => w.key ?? w.name,
    );
    const mergedPolicies = this.mergeByKey(
      before.permissionPolicies,
      planPolicies,
      (p) => `${p.role}::${p.resourceType}::${p.scope}::${p.name}`,
    );

    return {
      ...before,
      modules: mergedModules,
      views: [...before.views, ...planViews],
      dashboards: [...before.dashboards, ...planDashboards],
      workflows: mergedWorkflows,
      permissionPolicies: mergedPolicies,
    };
  }

  private toModule(module: AiChangePlan['modules'][number]): ModuleDefinition {
    return {
      name: module.name,
      key: module.key,
      kind: module.kind,
      description: module.description ?? null,
      config: module.config ?? null,
      entities: module.entities.map((entity) => this.toEntity(entity)),
    };
  }

  private toEntity(
    entity: AiChangePlan['modules'][number]['entities'][number],
  ): EntityDefinition {
    return {
      name: entity.name,
      key: entity.key,
      description: entity.description ?? null,
      config: entity.config ?? null,
      fields: entity.fields.map((field) => this.toField(field)),
    };
  }

  private toField(
    field: AiChangePlan['modules'][number]['entities'][number]['fields'][number],
  ): FieldDefinition {
    return {
      name: field.name,
      key: field.key,
      dataType: isFieldDataType(field.dataType) ? field.dataType : 'text',
      required: field.required,
      config: (field.config as FieldDefinition['config']) ?? null,
    };
  }

  private toViewType(type: string) {
    const allowed = ['table', 'form', 'kanban', 'calendar', 'chart', 'card'];
    return (allowed.includes(type) ? type : 'table') as
      | 'table'
      | 'form'
      | 'kanban'
      | 'calendar'
      | 'chart'
      | 'card';
  }

  private mergeModules(
    before: ModuleDefinition[],
    plan: ModuleDefinition[],
  ): ModuleDefinition[] {
    const byKey = new Map(before.map((m) => [m.key, m]));
    for (const mod of plan) {
      const existing = byKey.get(mod.key);
      if (!existing) {
        byKey.set(mod.key, mod);
        continue;
      }
      const entitiesByKey = new Map(existing.entities.map((e) => [e.key, e]));
      for (const entity of mod.entities) {
        const existingEntity = entitiesByKey.get(entity.key);
        if (!existingEntity) {
          entitiesByKey.set(entity.key, entity);
          continue;
        }
        const fieldsByKey = new Map(
          existingEntity.fields.map((f) => [f.key, f]),
        );
        for (const field of entity.fields) {
          fieldsByKey.set(field.key, field);
        }
        entitiesByKey.set(entity.key, {
          ...existingEntity,
          fields: Array.from(fieldsByKey.values()),
        });
      }
      byKey.set(mod.key, {
        ...existing,
        entities: Array.from(entitiesByKey.values()),
      });
    }
    return Array.from(byKey.values());
  }

  private mergeByKey<T>(
    before: T[],
    plan: T[],
    keyOf: (item: T) => string,
  ): T[] {
    const merged = [...before];
    for (const item of plan) {
      const identity = keyOf(item);
      const idx = merged.findIndex((existing) => keyOf(existing) === identity);
      if (idx >= 0) {
        merged[idx] = item;
      } else {
        merged.push(item);
      }
    }
    return merged;
  }

  private async createSupportingDefinitions(
    context: {
      organizationId: string;
      workspaceId: string;
      systemId: string;
      systemVersionId: string;
    },
    plan: AiChangePlan,
    actorUserId: string,
  ) {
    for (const workflow of plan.workflows) {
      await this.workflowsService.create(
        {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          systemId: context.systemId,
          systemVersionId: context.systemVersionId,
          name: workflow.name,
          key: workflow.key ?? slugify(workflow.name),
          triggerType: workflow.triggerType,
          definition: {
            ...workflow.definition,
            moduleKey: workflow.moduleKey ?? null,
          },
        },
        actorUserId,
      );
    }

    for (const policy of plan.permissionPolicies) {
      await this.permissionsService.create(
        {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          systemId: context.systemId,
          name: policy.name,
          scope: policy.scope,
          role: policy.role,
          resourceType: policy.resourceType,
          actions: policy.actions,
          fieldRestrictions: policy.fieldRestrictions ?? undefined,
          conditions: policy.conditions ?? undefined,
        },
        actorUserId,
      );
    }
  }

  private async createSupportingDefinitionsFromDefinition(
    context: {
      organizationId: string;
      workspaceId: string;
      systemId: string;
      systemVersionId: string;
    },
    def: SystemDefinition,
    actorUserId: string,
  ) {
    for (const workflow of def.workflows) {
      await this.workflowsService.create(
        {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          systemId: context.systemId,
          systemVersionId: context.systemVersionId,
          name: workflow.name,
          key: workflow.key ?? slugify(workflow.name),
          triggerType: workflow.triggerType,
          definition: {
            ...workflow.definition,
            moduleKey: workflow.moduleKey ?? null,
          },
        },
        actorUserId,
      );
    }

    for (const policy of def.permissionPolicies) {
      await this.permissionsService.create(
        {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          systemId: context.systemId,
          name: policy.name,
          scope: policy.scope,
          role: policy.role,
          resourceType: policy.resourceType,
          actions: policy.actions,
          fieldRestrictions: policy.fieldRestrictions ?? undefined,
          conditions: policy.conditions ?? undefined,
        },
        actorUserId,
      );
    }
  }
}
