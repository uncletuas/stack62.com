import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { AiChangeRequestEntity } from '../../modules/ai/entities/ai-change-request.entity';
import { CoworkerEntity } from '../../modules/coworker/entities/coworker.entity';
import { DocumentEntity } from '../../modules/documents/entities/document.entity';
import { FileEntity } from '../../modules/files/entities/file.entity';
import { BackgroundJobEntity } from '../../modules/jobs/entities/background-job.entity';
import { MembershipEntity } from '../../modules/memberships/entities/membership.entity';
import { OrganizationEntity } from '../../modules/organizations/entities/organization.entity';
import { PermissionPolicyEntity } from '../../modules/permissions/entities/permission-policy.entity';
import { RuntimeRecordEntity } from '../../modules/records/entities/runtime-record.entity';
import { ReportEntity } from '../../modules/reports/entities/report.entity';
import { ScheduleEntity } from '../../modules/schedules/entities/schedule.entity';
import { SharePackageEntity } from '../../modules/sharing/entities/share-package.entity';
import { SystemEntity } from '../../modules/systems/entities/system.entity';
import { TaskEntity } from '../../modules/tasks/entities/task.entity';
import { WorkflowDefinitionEntity } from '../../modules/workflows/entities/workflow-definition.entity';
import { WorkspaceEntity } from '../../modules/workspaces/entities/workspace.entity';
import {
  AccessAction,
  AccessControlRequirement,
  AccessResource,
  RequestValueReference,
} from './access-control.decorator';

interface TenantScope {
  organizationIds: string[];
  fullOrganizationIds: string[];
  workspaceIds: string[];
  workspaceIdsByOrganization: Record<string, string[]>;
  rolesByOrganization: Record<string, string[]>;
  rolesByWorkspace: Record<string, string[]>;
}

interface ResolvedAccessContext {
  resource: AccessResource;
  action: AccessAction;
  organizationId?: string | null;
  workspaceId?: string | null;
  systemId?: string | null;
  ownerUserId?: string | null;
}

const DEFAULT_ACTION_ROLES: Record<AccessAction, string[]> = {
  read: [
    'owner',
    'admin',
    'manager',
    'staff',
    'member',
    'reviewer',
    'read-only',
    'guest',
  ],
  create: ['owner', 'admin', 'manager', 'staff', 'member'],
  update: ['owner', 'admin', 'manager', 'staff', 'member'],
  publish: ['owner', 'admin', 'manager', 'staff', 'member'],
  share: ['owner', 'admin', 'manager'],
  manage_workflows: ['owner', 'admin', 'manager'],
  manage_permissions: ['owner', 'admin'],
  manage_ai: ['owner', 'admin'],
  apply_ai: ['owner', 'admin'],
  view_jobs: ['owner', 'admin', 'manager'],
  manage_memberships: ['owner', 'admin'],
};

const POLICY_RESOURCE_ALIASES: Record<AccessResource, string[]> = {
  organization: ['organization'],
  workspace: ['workspace'],
  membership: ['membership'],
  system: ['system'],
  record: ['record', 'entity', 'module'],
  activity: ['activity'],
  workflow_definition: ['workflow_definition', 'workflow'],
  workflow_run: ['workflow_run', 'workflow'],
  permission_policy: ['permission_policy', 'permission'],
  share_package: ['share_package', 'sharing'],
  ai_change_request: ['ai_change_request', 'ai'],
  background_job: ['background_job', 'job'],
  task: ['task'],
  schedule: ['schedule'],
  file: ['file'],
  document: ['document'],
  report: ['report'],
  coworker: ['coworker', 'ai'],
  integration: ['integration'],
  tool_call: ['tool_call', 'ai'],
};

@Injectable()
export class AccessControlService {
  constructor(
    @InjectRepository(AiChangeRequestEntity)
    private readonly aiChangeRequestsRepository: Repository<AiChangeRequestEntity>,
    @InjectRepository(BackgroundJobEntity)
    private readonly backgroundJobsRepository: Repository<BackgroundJobEntity>,
    @InjectRepository(CoworkerEntity)
    private readonly coworkersRepository: Repository<CoworkerEntity>,
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    @InjectRepository(FileEntity)
    private readonly filesRepository: Repository<FileEntity>,
    @InjectRepository(MembershipEntity)
    private readonly membershipsRepository: Repository<MembershipEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationsRepository: Repository<OrganizationEntity>,
    @InjectRepository(PermissionPolicyEntity)
    private readonly permissionPoliciesRepository: Repository<PermissionPolicyEntity>,
    @InjectRepository(RuntimeRecordEntity)
    private readonly recordsRepository: Repository<RuntimeRecordEntity>,
    @InjectRepository(ReportEntity)
    private readonly reportsRepository: Repository<ReportEntity>,
    @InjectRepository(ScheduleEntity)
    private readonly schedulesRepository: Repository<ScheduleEntity>,
    @InjectRepository(SharePackageEntity)
    private readonly sharePackagesRepository: Repository<SharePackageEntity>,
    @InjectRepository(SystemEntity)
    private readonly systemsRepository: Repository<SystemEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly workflowsRepository: Repository<WorkflowDefinitionEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspacesRepository: Repository<WorkspaceEntity>,
  ) {}

  async assertRequestAccess(
    userId: string,
    requirement: AccessControlRequirement,
    request: {
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
    },
  ) {
    const resourceId = this.resolveRequestValue(
      request,
      requirement.resourceId,
    );
    const organizationId = this.resolveRequestValue(
      request,
      requirement.organizationId,
    );
    const workspaceId = this.resolveRequestValue(
      request,
      requirement.workspaceId,
    );
    const systemId = this.resolveRequestValue(request, requirement.systemId);

    if (
      !resourceId &&
      !organizationId &&
      !workspaceId &&
      !systemId &&
      !requirement.allowUnscoped
    ) {
      throw new BadRequestException(
        'Tenant scope is required for this operation.',
      );
    }

    if (!resourceId && !organizationId && !workspaceId && !systemId) {
      return;
    }

    switch (requirement.resource) {
      case 'system':
        if (resourceId) {
          await this.assertSystemAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'record':
        if (resourceId) {
          await this.assertRecordAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'workflow_definition':
        if (resourceId) {
          await this.assertWorkflowAccess(
            userId,
            resourceId,
            requirement.action,
          );
          return;
        }
        break;
      case 'share_package':
        if (resourceId) {
          await this.assertSharePackageAccess(
            userId,
            resourceId,
            requirement.action,
          );
          return;
        }
        break;
      case 'ai_change_request':
        if (resourceId) {
          await this.assertAiChangeRequestAccess(
            userId,
            resourceId,
            requirement.action,
          );
          return;
        }
        break;
      case 'background_job':
        if (resourceId) {
          await this.assertBackgroundJobAccess(
            userId,
            resourceId,
            requirement.action,
          );
          return;
        }
        break;
      case 'task':
        if (resourceId) {
          await this.assertTaskAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'schedule':
        if (resourceId) {
          await this.assertScheduleAccess(
            userId,
            resourceId,
            requirement.action,
          );
          return;
        }
        break;
      case 'document':
        if (resourceId) {
          await this.assertDocumentAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'file':
        if (resourceId) {
          await this.assertFileAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'report':
        if (resourceId) {
          await this.assertReportAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'coworker':
        if (resourceId) {
          await this.assertCoworkerAccess(userId, resourceId, requirement.action);
          return;
        }
        break;
      case 'workspace':
        if (resourceId) {
          const workspace = await this.workspacesRepository.findOne({
            where: { id: resourceId },
          });
          if (!workspace) {
            throw new NotFoundException('Workspace not found.');
          }

          await this.assertResolvedAccess(userId, {
            resource: 'workspace',
            action: requirement.action,
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
          });
          return;
        }
        break;
      case 'organization':
        if (resourceId) {
          await this.assertResolvedAccess(userId, {
            resource: 'organization',
            action: requirement.action,
            organizationId: resourceId,
          });
          return;
        }
        break;
      default:
        break;
    }

    await this.assertResolvedAccess(userId, {
      resource: requirement.resource,
      action: requirement.action,
      organizationId,
      workspaceId,
      systemId,
    });
  }

  async assertResolvedAccess(userId: string, context: ResolvedAccessContext) {
    let organizationId = context.organizationId ?? null;
    let workspaceId = context.workspaceId ?? null;
    const systemId = context.systemId ?? null;

    if (systemId && (!organizationId || !workspaceId)) {
      const system = await this.systemsRepository.findOne({
        where: { id: systemId },
      });
      if (!system) {
        throw new NotFoundException('System not found.');
      }

      organizationId = system.organizationId;
      workspaceId = system.workspaceId;
    }

    if (workspaceId && !organizationId) {
      const workspace = await this.workspacesRepository.findOne({
        where: { id: workspaceId },
      });
      if (!workspace) {
        throw new NotFoundException('Workspace not found.');
      }

      organizationId = workspace.organizationId;
    }

    if (!organizationId) {
      throw new BadRequestException(
        'Unable to resolve organization scope for this operation.',
      );
    }

    const scope = await this.getTenantScope(userId);
    if (!scope.organizationIds.includes(organizationId)) {
      throw new ForbiddenException(
        'You do not have access to the requested organization scope.',
      );
    }

    const hasFullOrganizationAccess =
      scope.fullOrganizationIds.includes(organizationId);

    if (workspaceId) {
      const workspaceIds =
        scope.workspaceIdsByOrganization[organizationId] ?? [];
      if (!hasFullOrganizationAccess && !workspaceIds.includes(workspaceId)) {
        throw new ForbiddenException(
          'You do not have access to the requested workspace scope.',
        );
      }
    }

    if (
      !workspaceId &&
      context.action !== 'read' &&
      !hasFullOrganizationAccess
    ) {
      throw new ForbiddenException(
        'This operation requires organization-level access.',
      );
    }

    const roles = this.resolveContextRoles(scope, organizationId, workspaceId, {
      includeWorkspaceReadRoles: context.action === 'read' && !workspaceId,
    });
    if (roles.length === 0) {
      throw new ForbiddenException(
        'You do not have any active roles in the requested tenant scope.',
      );
    }

    const allowed = await this.isActionAllowed(userId, roles, {
      ...context,
      organizationId,
      workspaceId,
      systemId,
    });

    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }
  }

  /**
   * Assert that a Coworker (acting on behalf of the human user) is allowed
   * to perform the requested action. Uses the Coworker's role directly
   * against permission policies and the default role-action map. The caller
   * must independently verify the human user's access via
   * `assertResolvedAccess` — this method does NOT check the user.
   */
  async assertCoworkerCanAct(
    coworkerRole: string,
    context: ResolvedAccessContext,
  ) {
    let organizationId = context.organizationId ?? null;
    let workspaceId = context.workspaceId ?? null;
    const systemId = context.systemId ?? null;

    if (systemId && (!organizationId || !workspaceId)) {
      const system = await this.systemsRepository.findOne({
        where: { id: systemId },
      });
      if (!system) {
        throw new NotFoundException('System not found.');
      }
      organizationId = system.organizationId;
      workspaceId = system.workspaceId;
    }

    if (workspaceId && !organizationId) {
      const workspace = await this.workspacesRepository.findOne({
        where: { id: workspaceId },
      });
      if (!workspace) {
        throw new NotFoundException('Workspace not found.');
      }
      organizationId = workspace.organizationId;
    }

    if (!organizationId) {
      throw new BadRequestException(
        'Unable to resolve organization scope for this Coworker action.',
      );
    }

    const allowed = await this.isActionAllowed('__coworker__', [coworkerRole], {
      ...context,
      organizationId,
      workspaceId,
      systemId,
    });

    if (!allowed) {
      throw new ForbiddenException(
        `Coworker role "${coworkerRole}" cannot perform this action.`,
      );
    }
  }

  async assertSystemAccess(
    userId: string,
    systemId: string,
    action: AccessAction,
  ) {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system) {
      throw new NotFoundException('System not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'system',
      action,
      organizationId: system.organizationId,
      workspaceId: system.workspaceId,
      systemId: system.id,
    });
  }

  async assertRecordAccess(
    userId: string,
    recordId: string,
    action: AccessAction,
  ) {
    const record = await this.recordsRepository.findOne({
      where: { id: recordId },
    });
    if (!record) {
      throw new NotFoundException('Record not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'record',
      action,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      systemId: record.systemId,
      ownerUserId: record.createdByUserId,
    });
  }

  async assertWorkflowAccess(
    userId: string,
    workflowId: string,
    action: AccessAction,
  ) {
    const workflow = await this.workflowsRepository.findOne({
      where: { id: workflowId },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow definition not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'workflow_definition',
      action,
      organizationId: workflow.organizationId,
      workspaceId: workflow.workspaceId,
      systemId: workflow.systemId,
      ownerUserId: workflow.createdByUserId,
    });
  }

  async assertSharePackageAccess(
    userId: string,
    sharePackageId: string,
    action: AccessAction,
  ) {
    const sharePackage = await this.sharePackagesRepository.findOne({
      where: { id: sharePackageId },
    });
    if (!sharePackage) {
      throw new NotFoundException('Share package not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'share_package',
      action,
      organizationId: sharePackage.organizationId,
      workspaceId: sharePackage.workspaceId,
      systemId: sharePackage.systemId,
      ownerUserId: sharePackage.createdByUserId,
    });
  }

  async assertAiChangeRequestAccess(
    userId: string,
    requestId: string,
    action: AccessAction,
  ) {
    const request = await this.aiChangeRequestsRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('AI change request not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'ai_change_request',
      action,
      organizationId: request.organizationId,
      workspaceId: request.workspaceId,
      systemId: request.systemId,
      ownerUserId: request.actorUserId,
    });
  }

  async assertBackgroundJobAccess(
    userId: string,
    jobId: string,
    action: AccessAction,
  ) {
    const job = await this.backgroundJobsRepository.findOne({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException('Background job not found.');
    }

    if (!job.organizationId) {
      if (job.actorUserId === userId) {
        return;
      }

      throw new ForbiddenException(
        'You do not have access to the requested background job.',
      );
    }

    await this.assertResolvedAccess(userId, {
      resource: 'background_job',
      action,
      organizationId: job.organizationId,
      workspaceId: job.workspaceId,
      systemId: job.systemId,
      ownerUserId: job.actorUserId,
    });
  }

  async assertTaskAccess(userId: string, taskId: string, action: AccessAction) {
    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'task',
      action,
      organizationId: task.organizationId,
      workspaceId: task.workspaceId,
      systemId: task.systemId,
      ownerUserId: task.createdByUserId,
    });
  }

  async assertScheduleAccess(
    userId: string,
    scheduleId: string,
    action: AccessAction,
  ) {
    const schedule = await this.schedulesRepository.findOne({
      where: { id: scheduleId },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule not found.');
    }

    await this.assertResolvedAccess(userId, {
      resource: 'schedule',
      action,
      organizationId: schedule.organizationId,
      workspaceId: schedule.workspaceId,
      systemId: schedule.systemId,
      ownerUserId: schedule.createdByUserId,
    });
  }

  async assertDocumentAccess(
    userId: string,
    documentId: string,
    action: AccessAction,
  ) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found.');
    await this.assertResolvedAccess(userId, {
      resource: 'document',
      action,
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
      ownerUserId: document.createdByUserId,
    });
  }

  async assertFileAccess(userId: string, fileId: string, action: AccessAction) {
    const file = await this.filesRepository.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found.');
    await this.assertResolvedAccess(userId, {
      resource: 'file',
      action,
      organizationId: file.organizationId,
      workspaceId: file.workspaceId,
      systemId: file.systemId,
      ownerUserId: file.uploadedByUserId,
    });
  }

  async assertReportAccess(
    userId: string,
    reportId: string,
    action: AccessAction,
  ) {
    const report = await this.reportsRepository.findOne({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found.');
    await this.assertResolvedAccess(userId, {
      resource: 'report',
      action,
      organizationId: report.organizationId,
      workspaceId: report.workspaceId,
      systemId: report.systemId,
      ownerUserId: report.createdByUserId,
    });
  }

  async assertCoworkerAccess(
    userId: string,
    coworkerId: string,
    action: AccessAction,
  ) {
    const coworker = await this.coworkersRepository.findOne({
      where: { id: coworkerId },
    });
    if (!coworker) throw new NotFoundException('Coworker not found.');
    await this.assertResolvedAccess(userId, {
      resource: 'coworker',
      action,
      organizationId: coworker.organizationId,
      workspaceId: coworker.workspaceId,
    });
  }

  async getAccessibleOrganizationIds(userId: string) {
    const scope = await this.getTenantScope(userId);
    return scope.organizationIds;
  }

  async applyTenantScopeToQueryBuilder<Entity extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<Entity>,
    alias: string,
    userId: string,
    options?: {
      organizationField?: string;
      workspaceField?: string;
      organizationId?: string;
      workspaceId?: string;
    },
  ) {
    const scope = await this.getTenantScope(userId);
    const organizationField = options?.organizationField ?? 'organizationId';
    const workspaceField = options?.workspaceField;
    const organizationId = options?.organizationId;
    const workspaceId = options?.workspaceId;

    if (!workspaceField) {
      if (organizationId) {
        if (!scope.organizationIds.includes(organizationId)) {
          throw new ForbiddenException(
            'You do not have access to the requested organization scope.',
          );
        }

        queryBuilder.andWhere(
          `${alias}.${organizationField} = :organizationId`,
          {
            organizationId,
          },
        );
        return;
      }

      if (scope.organizationIds.length === 0) {
        queryBuilder.andWhere('1 = 0');
        return;
      }

      queryBuilder.andWhere(
        `${alias}.${organizationField} IN (:...accessibleOrganizationIds)`,
        {
          accessibleOrganizationIds: scope.organizationIds,
        },
      );
      return;
    }

    if (workspaceId) {
      await this.assertResolvedAccess(userId, {
        resource: 'workspace',
        action: 'read',
        organizationId: organizationId ?? undefined,
        workspaceId,
      });

      if (organizationId) {
        queryBuilder.andWhere(
          `${alias}.${organizationField} = :organizationId`,
          {
            organizationId,
          },
        );
      }

      queryBuilder.andWhere(`${alias}.${workspaceField} = :workspaceId`, {
        workspaceId,
      });
      return;
    }

    if (organizationId) {
      if (!scope.organizationIds.includes(organizationId)) {
        throw new ForbiddenException(
          'You do not have access to the requested organization scope.',
        );
      }

      queryBuilder.andWhere(`${alias}.${organizationField} = :organizationId`, {
        organizationId,
      });

      if (scope.fullOrganizationIds.includes(organizationId)) {
        return;
      }

      const organizationWorkspaceIds =
        scope.workspaceIdsByOrganization[organizationId] ?? [];
      if (organizationWorkspaceIds.length === 0) {
        queryBuilder.andWhere('1 = 0');
        return;
      }

      queryBuilder.andWhere(
        `${alias}.${workspaceField} IN (:...organizationWorkspaceIds)`,
        {
          organizationWorkspaceIds,
        },
      );
      return;
    }

    const clauses: string[] = [];
    const parameters: Record<string, string[]> = {};

    if (scope.fullOrganizationIds.length > 0) {
      clauses.push(
        `${alias}.${organizationField} IN (:...fullOrganizationIds)`,
      );
      parameters.fullOrganizationIds = scope.fullOrganizationIds;
    }

    if (scope.workspaceIds.length > 0) {
      clauses.push(`${alias}.${workspaceField} IN (:...workspaceIds)`);
      parameters.workspaceIds = scope.workspaceIds;
    }

    if (clauses.length === 0) {
      queryBuilder.andWhere('1 = 0');
      return;
    }

    queryBuilder.andWhere(
      new Brackets((qb) => {
        for (const [index, clause] of clauses.entries()) {
          if (index === 0) {
            qb.where(clause, parameters);
          } else {
            qb.orWhere(clause, parameters);
          }
        }
      }),
    );
  }

  private async getTenantScope(userId: string): Promise<TenantScope> {
    const ownedOrganizations = await this.organizationsRepository.find({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const memberships = await this.membershipsRepository.find({
      where: {
        userId,
        status: 'active',
      },
    });

    const organizationIds = new Set<string>(
      ownedOrganizations.map((item) => item.id),
    );
    const fullOrganizationIds = new Set<string>(
      ownedOrganizations.map((item) => item.id),
    );
    const workspaceIds = new Set<string>();
    const workspaceIdsByOrganization: Record<string, string[]> = {};
    const rolesByOrganization: Record<string, Set<string>> = {};
    const rolesByWorkspace: Record<string, Set<string>> = {};

    for (const organization of ownedOrganizations) {
      rolesByOrganization[organization.id] = new Set(['owner', 'admin']);
    }

    for (const membership of memberships) {
      organizationIds.add(membership.organizationId);

      const normalizedRole = this.normalizeValue(membership.role);
      if (!rolesByOrganization[membership.organizationId]) {
        rolesByOrganization[membership.organizationId] = new Set<string>();
      }

      if (membership.workspaceId) {
        workspaceIds.add(membership.workspaceId);
        workspaceIdsByOrganization[membership.organizationId] =
          workspaceIdsByOrganization[membership.organizationId] ?? [];
        if (
          !workspaceIdsByOrganization[membership.organizationId].includes(
            membership.workspaceId,
          )
        ) {
          workspaceIdsByOrganization[membership.organizationId].push(
            membership.workspaceId,
          );
        }

        rolesByWorkspace[membership.workspaceId] =
          rolesByWorkspace[membership.workspaceId] ?? new Set<string>();
        rolesByWorkspace[membership.workspaceId].add(normalizedRole);
      } else {
        fullOrganizationIds.add(membership.organizationId);
        rolesByOrganization[membership.organizationId].add(normalizedRole);
      }
    }

    return {
      organizationIds: Array.from(organizationIds),
      fullOrganizationIds: Array.from(fullOrganizationIds),
      workspaceIds: Array.from(workspaceIds),
      workspaceIdsByOrganization,
      rolesByOrganization: Object.fromEntries(
        Object.entries(rolesByOrganization).map(([key, value]) => [
          key,
          Array.from(value),
        ]),
      ),
      rolesByWorkspace: Object.fromEntries(
        Object.entries(rolesByWorkspace).map(([key, value]) => [
          key,
          Array.from(value),
        ]),
      ),
    };
  }

  private resolveContextRoles(
    scope: TenantScope,
    organizationId: string,
    workspaceId?: string | null,
    options?: { includeWorkspaceReadRoles?: boolean },
  ) {
    const roles = new Set(scope.rolesByOrganization[organizationId] ?? []);

    if (workspaceId) {
      for (const role of scope.rolesByWorkspace[workspaceId] ?? []) {
        roles.add(role);
      }
    } else if (options?.includeWorkspaceReadRoles) {
      for (const scopedWorkspaceId of scope.workspaceIdsByOrganization[
        organizationId
      ] ?? []) {
        for (const role of scope.rolesByWorkspace[scopedWorkspaceId] ?? []) {
          roles.add(role);
        }
      }
    }

    return Array.from(roles);
  }

  private async isActionAllowed(
    userId: string,
    roles: string[],
    context: Required<Pick<ResolvedAccessContext, 'resource' | 'action'>> &
      Omit<ResolvedAccessContext, 'resource' | 'action'>,
  ) {
    const normalizedRoles = roles.map((role) => this.normalizeValue(role));
    const relevantPolicies = await this.permissionPoliciesRepository.find({
      where: {
        organizationId: context.organizationId ?? undefined,
        status: 'active',
      },
    });

    const matchingPolicies = relevantPolicies.filter((policy) => {
      const policyRole = this.normalizeValue(policy.role);
      if (!normalizedRoles.includes(policyRole)) {
        return false;
      }

      if (policy.workspaceId && policy.workspaceId !== context.workspaceId) {
        return false;
      }

      if (policy.systemId && policy.systemId !== context.systemId) {
        return false;
      }

      return this.matchesPolicyResource(policy.resourceType, context.resource);
    });

    if (matchingPolicies.length > 0) {
      const isOwnResource = Boolean(
        context.ownerUserId && context.ownerUserId === userId,
      );
      return matchingPolicies.some((policy) =>
        policy.actions.some((action) =>
          this.matchesPolicyAction(action, context.action, isOwnResource),
        ),
      );
    }

    const allowedRoles = DEFAULT_ACTION_ROLES[context.action] ?? [];
    return normalizedRoles.some((role) => allowedRoles.includes(role));
  }

  private matchesPolicyResource(
    policyResourceType: string,
    resource: AccessResource,
  ) {
    const normalizedPolicyResource = this.normalizeValue(policyResourceType);
    if (normalizedPolicyResource === '*') {
      return true;
    }

    return POLICY_RESOURCE_ALIASES[resource].includes(normalizedPolicyResource);
  }

  private matchesPolicyAction(
    policyAction: string,
    action: AccessAction,
    isOwnResource: boolean,
  ) {
    const normalizedAction = this.normalizeValue(policyAction);
    if (
      normalizedAction === '*' ||
      normalizedAction === this.normalizeValue(action)
    ) {
      return true;
    }

    const ownAction = `${this.normalizeValue(action)}_own`;
    return normalizedAction === ownAction && isOwnResource;
  }

  private resolveRequestValue(
    request: {
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
    },
    reference?: RequestValueReference,
  ) {
    if (!reference) {
      return undefined;
    }

    const sourceData =
      reference.source === 'body'
        ? request.body
        : reference.source === 'query'
          ? request.query
          : request.params;

    const value = sourceData?.[reference.key];
    if (value === undefined || value === null || value === '') {
      if (reference.optional) {
        return undefined;
      }

      return undefined;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }

    throw new BadRequestException(
      `Invalid scoped request value for '${reference.key}'.`,
    );
  }

  private normalizeValue(value: string) {
    return value.trim().toLowerCase();
  }
}
