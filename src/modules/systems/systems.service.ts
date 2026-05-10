import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { PermissionPolicyEntity } from '../permissions/entities/permission-policy.entity';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { WorkflowDefinitionEntity } from '../workflows/entities/workflow-definition.entity';
import { slugify } from '../../shared/utils/slugify';
import {
  SystemDefinition,
  emptySystemDefinition,
  safeParseSystemDefinition,
} from '../../shared/system-definition';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { CreateSystemDto } from './dto/create-system.dto';
import { ListSystemsDto } from './dto/list-systems.dto';
import { PublishSystemVersionDto } from './dto/publish-system-version.dto';
import { DashboardConfigEntity } from './entities/dashboard-config.entity';
import { EntityDefinitionEntity } from './entities/entity-definition.entity';
import { FieldDefinitionEntity } from './entities/field-definition.entity';
import { ModuleDefinitionEntity } from './entities/module-definition.entity';
import { SystemEntity } from './entities/system.entity';
import { SystemVersionEntity } from './entities/system-version.entity';
import { ViewConfigEntity } from './entities/view-config.entity';

@Injectable()
export class SystemsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SystemEntity)
    private readonly systemsRepository: Repository<SystemEntity>,
    @InjectRepository(SystemVersionEntity)
    private readonly versionsRepository: Repository<SystemVersionEntity>,
    @InjectRepository(ModuleDefinitionEntity)
    private readonly modulesRepository: Repository<ModuleDefinitionEntity>,
    @InjectRepository(EntityDefinitionEntity)
    private readonly entityDefinitionsRepository: Repository<EntityDefinitionEntity>,
    @InjectRepository(FieldDefinitionEntity)
    private readonly fieldDefinitionsRepository: Repository<FieldDefinitionEntity>,
    @InjectRepository(ViewConfigEntity)
    private readonly viewsRepository: Repository<ViewConfigEntity>,
    @InjectRepository(DashboardConfigEntity)
    private readonly dashboardsRepository: Repository<DashboardConfigEntity>,
    @InjectRepository(WorkflowDefinitionEntity)
    private readonly workflowsRepository: Repository<WorkflowDefinitionEntity>,
    @InjectRepository(PermissionPolicyEntity)
    private readonly permissionPoliciesRepository: Repository<PermissionPolicyEntity>,
    @InjectRepository(RuntimeRecordEntity)
    private readonly runtimeRecordsRepository: Repository<RuntimeRecordEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreateSystemDto, actorUserId: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const systemRepository = manager.getRepository(SystemEntity);
      const versionRepository = manager.getRepository(SystemVersionEntity);
      const moduleRepository = manager.getRepository(ModuleDefinitionEntity);
      const entityRepository = manager.getRepository(EntityDefinitionEntity);
      const fieldRepository = manager.getRepository(FieldDefinitionEntity);
      const viewRepository = manager.getRepository(ViewConfigEntity);
      const dashboardRepository = manager.getRepository(DashboardConfigEntity);

      const system = systemRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        createdByUserId: actorUserId,
        name: payload.name,
        slug: `${slugify(payload.name)}-${Date.now().toString().slice(-6)}`,
        purpose: payload.purpose ?? null,
        description: payload.description ?? null,
        teamSize: payload.teamSize ?? null,
        industryType: payload.industryType ?? null,
        governanceMode: payload.governanceMode ?? 'standard',
        visibility: payload.visibility ?? 'private',
        status: 'draft',
        publishedVersionId: null,
      });

      const createdSystem = await systemRepository.save(system);

      const version = versionRepository.create({
        systemId: createdSystem.id,
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        createdByUserId: actorUserId,
        versionNumber: 1,
        status: 'draft',
        changeSummary: 'Initial system definition draft',
        sourcePrompt: payload.sourcePrompt ?? null,
        definitionSnapshot: {
          name: payload.name,
          purpose: payload.purpose ?? null,
          description: payload.description ?? null,
          teamSize: payload.teamSize ?? null,
          industryType: payload.industryType ?? null,
          governanceMode: payload.governanceMode ?? 'standard',
          visibility: payload.visibility ?? 'private',
          modules: payload.modules ?? [],
          views: payload.views ?? [],
          dashboards: payload.dashboards ?? [],
        },
        compiledSnapshot: null,
        publishedAt: null,
      });

      const createdVersion = await versionRepository.save(version);

      for (const modulePayload of payload.modules ?? []) {
        const createdModule = await moduleRepository.save(
          moduleRepository.create({
            systemId: createdSystem.id,
            systemVersionId: createdVersion.id,
            name: modulePayload.name,
            key: modulePayload.key ?? slugify(modulePayload.name),
            kind: modulePayload.kind ?? 'custom',
            description: modulePayload.description ?? null,
            config: modulePayload.config ?? null,
          }),
        );

        for (const entityPayload of modulePayload.entities ?? []) {
          const createdEntity = await entityRepository.save(
            entityRepository.create({
              systemId: createdSystem.id,
              systemVersionId: createdVersion.id,
              moduleDefinitionId: createdModule.id,
              name: entityPayload.name,
              key: entityPayload.key ?? slugify(entityPayload.name),
              description: entityPayload.description ?? null,
              config: entityPayload.config ?? null,
            }),
          );

          for (const fieldPayload of entityPayload.fields ?? []) {
            await fieldRepository.save(
              fieldRepository.create({
                systemId: createdSystem.id,
                systemVersionId: createdVersion.id,
                entityDefinitionId: createdEntity.id,
                name: fieldPayload.name,
                key: fieldPayload.key ?? slugify(fieldPayload.name),
                dataType: fieldPayload.dataType,
                required: fieldPayload.required ?? false,
                config: fieldPayload.config ?? null,
              }),
            );
          }
        }
      }

      for (const viewPayload of payload.views ?? []) {
        await viewRepository.save(
          viewRepository.create({
            systemId: createdSystem.id,
            systemVersionId: createdVersion.id,
            name: viewPayload.name,
            type: viewPayload.type,
            entityDefinitionId: viewPayload.entityDefinitionId ?? null,
            config: viewPayload.config ?? null,
          }),
        );
      }

      for (const dashboardPayload of payload.dashboards ?? []) {
        await dashboardRepository.save(
          dashboardRepository.create({
            systemId: createdSystem.id,
            systemVersionId: createdVersion.id,
            name: dashboardPayload.name,
            scope: dashboardPayload.scope ?? 'system',
            widgets: dashboardPayload.widgets ?? [],
          }),
        );
      }

      return {
        system: createdSystem,
        version: createdVersion,
      };
    });

    await this.activityService.log({
      organizationId: result.system.organizationId,
      workspaceId: result.system.workspaceId,
      systemId: result.system.id,
      actorUserId,
      action: 'system.create',
      targetType: 'system',
      targetId: result.system.id,
      origin: 'user',
      metadata: {
        versionId: result.version.id,
        name: result.system.name,
        slug: result.system.slug,
      },
    });

    return result;
  }

  async findAll(filters: ListSystemsDto, actorUserId: string) {
    const queryBuilder = this.systemsRepository.createQueryBuilder('system');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'system',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.status) {
      queryBuilder.andWhere('system.status = :status', {
        status: filters.status,
      });
    } else {
      queryBuilder.andWhere('system.status != :deletedStatus', {
        deletedStatus: 'deleted',
      });
    }

    return queryBuilder.orderBy('system.createdAt', 'DESC').getMany();
  }

  async findOne(systemId: string) {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });

    if (!system) {
      throw new NotFoundException('System not found.');
    }

    const versions = await this.versionsRepository.find({
      where: { systemId },
      order: { versionNumber: 'DESC' },
    });

    const activeVersion =
      versions.find((version) => version.id === system.publishedVersionId) ??
      versions[0] ??
      null;

    const activeVersionId = activeVersion?.id ?? null;
    const modules = activeVersionId
      ? await this.modulesRepository.find({
          where: { systemId, systemVersionId: activeVersionId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const entities = activeVersionId
      ? await this.entityDefinitionsRepository.find({
          where: { systemId, systemVersionId: activeVersionId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const fields = activeVersionId
      ? await this.fieldDefinitionsRepository.find({
          where: { systemId, systemVersionId: activeVersionId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const views = activeVersionId
      ? await this.viewsRepository.find({
          where: { systemId, systemVersionId: activeVersionId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const dashboards = activeVersionId
      ? await this.dashboardsRepository.find({
          where: { systemId, systemVersionId: activeVersionId },
          order: { createdAt: 'ASC' },
        })
      : [];
    const workflows = await this.workflowsRepository.find({
      where: { systemId },
      order: { createdAt: 'DESC' },
    });
    const permissionPolicies = await this.permissionPoliciesRepository.find({
      where: { systemId },
      order: { createdAt: 'DESC' },
    });
    const runtimeRecords = await this.runtimeRecordsRepository.find({
      where: { systemId },
      order: { createdAt: 'DESC' },
    });

    const entitiesByModule = new Map<string, EntityDefinitionEntity[]>();
    for (const entity of entities) {
      const current = entitiesByModule.get(entity.moduleDefinitionId) ?? [];
      current.push(entity);
      entitiesByModule.set(entity.moduleDefinitionId, current);
    }

    const fieldsByEntity = new Map<string, FieldDefinitionEntity[]>();
    for (const field of fields) {
      const current = fieldsByEntity.get(field.entityDefinitionId) ?? [];
      current.push(field);
      fieldsByEntity.set(field.entityDefinitionId, current);
    }

    const moduleSummaries = modules.map((module) => {
      const moduleEntities = (entitiesByModule.get(module.id) ?? []).map(
        (entity) => ({
          ...entity,
          fields: fieldsByEntity.get(entity.id) ?? [],
        }),
      );

      const moduleRecords = runtimeRecords.filter(
        (record) => record.moduleDefinitionId === module.id,
      );
      const pendingRecords = moduleRecords.filter((record) =>
        this.isPendingStatus(record.status),
      );

      return {
        ...module,
        entities: moduleEntities,
        recordCount: moduleRecords.length,
        pendingCount: pendingRecords.length,
      };
    });

    const metrics = {
      totalRecords: runtimeRecords.length,
      activeRecords: runtimeRecords.filter(
        (record) => record.status === 'active',
      ).length,
      pendingRecords: runtimeRecords.filter((record) =>
        this.isPendingStatus(record.status),
      ).length,
      moduleCount: moduleSummaries.length,
      workflowCount: workflows.length,
      dashboardCount: dashboards.length,
    };

    return {
      ...system,
      versions,
      activeVersion,
      modules: moduleSummaries,
      views,
      dashboards,
      workflows,
      permissionPolicies,
      metrics,
    };
  }

  async findVersions(systemId: string) {
    return this.versionsRepository.find({
      where: { systemId },
      order: { versionNumber: 'DESC' },
    });
  }

  async delete(systemId: string, actorUserId: string) {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system) throw new NotFoundException('System not found.');

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'update',
      organizationId: system.organizationId,
      workspaceId: system.workspaceId,
      systemId: system.id,
      ownerUserId: system.createdByUserId,
    });

    const beforeData = { ...system };
    system.status = 'deleted';
    const deleted = await this.systemsRepository.save(system);

    await this.activityService.log({
      organizationId: deleted.organizationId,
      workspaceId: deleted.workspaceId,
      systemId: deleted.id,
      actorUserId,
      action: 'system.delete',
      targetType: 'system',
      targetId: deleted.id,
      origin: 'user',
      metadata: { name: deleted.name },
    });

    await this.auditService.log({
      organizationId: deleted.organizationId,
      workspaceId: deleted.workspaceId,
      systemId: deleted.id,
      actorUserId,
      action: 'system.delete',
      targetType: 'system',
      targetId: deleted.id,
      beforeData,
      afterData: deleted,
    });

    return deleted;
  }

  async publish(
    systemId: string,
    payload: PublishSystemVersionDto,
    actorUserId: string,
  ) {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system) {
      throw new NotFoundException('System not found.');
    }

    const previousPublishedVersionId = system.publishedVersionId;

    const version = payload.rollbackToVersionId
      ? await this.versionsRepository.findOne({
          where: { id: payload.rollbackToVersionId, systemId },
        })
      : payload.versionId
        ? await this.versionsRepository.findOne({
            where: { id: payload.versionId, systemId },
          })
        : await this.versionsRepository.findOne({
            where: { systemId, status: 'draft' },
            order: { versionNumber: 'DESC' },
          });

    if (!version) {
      throw new NotFoundException('System version not found.');
    }

    if (!version.definitionSnapshot) {
      throw new UnprocessableEntityException(
        'System version has no definition snapshot to publish.',
      );
    }

    const isRollback = Boolean(payload.rollbackToVersionId);

    await this.versionsRepository.update(
      { systemId, status: 'published' },
      { status: 'archived' },
    );

    version.status = 'published';
    version.publishedAt = new Date();
    version.changeSummary =
      payload.changeSummary ??
      (isRollback
        ? `Rollback to stable version ${version.versionNumber}`
        : version.changeSummary);
    version.compiledSnapshot = version.definitionSnapshot;
    const publishedVersion = await this.versionsRepository.save(version);

    system.publishedVersionId = publishedVersion.id;
    system.status = 'active';
    const updatedSystem = await this.systemsRepository.save(system);

    await this.activityService.log({
      organizationId: updatedSystem.organizationId,
      workspaceId: updatedSystem.workspaceId,
      systemId: updatedSystem.id,
      actorUserId,
      action: isRollback ? 'system.rollback_publish' : 'system.publish',
      targetType: 'system_version',
      targetId: publishedVersion.id,
      origin: 'user',
      metadata: {
        systemId: updatedSystem.id,
        versionNumber: publishedVersion.versionNumber,
        rollbackToVersionId: payload.rollbackToVersionId ?? null,
      },
    });

    await this.auditService.log({
      organizationId: updatedSystem.organizationId,
      workspaceId: updatedSystem.workspaceId,
      systemId: updatedSystem.id,
      actorUserId,
      action: isRollback ? 'system.rollback_publish' : 'system.publish',
      targetType: 'system_version',
      targetId: publishedVersion.id,
      beforeData: {
        previousPublishedVersionId,
      },
      afterData: {
        publishedVersionId: publishedVersion.id,
        status: updatedSystem.status,
      },
      metadata: {
        rollbackToVersionId: payload.rollbackToVersionId ?? null,
        versionNumber: publishedVersion.versionNumber,
      },
    });

    return {
      system: updatedSystem,
      version: publishedVersion,
    };
  }

  async getPublishedDefinition(systemId: string): Promise<SystemDefinition> {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system || !system.publishedVersionId) {
      return emptySystemDefinition();
    }
    const version = await this.versionsRepository.findOne({
      where: { id: system.publishedVersionId },
    });
    if (!version?.definitionSnapshot) {
      return emptySystemDefinition();
    }
    const workflows = await this.workflowsRepository.find({
      where: { systemId },
    });
    const policies = await this.permissionPoliciesRepository.find({
      where: { systemId },
    });
    const candidate = {
      ...version.definitionSnapshot,
      workflows: workflows.map((w) => ({
        name: w.name,
        key: w.key,
        triggerType: w.triggerType,
        moduleKey:
          (w.definition as Record<string, unknown> | null)?.moduleKey ?? null,
        definition: w.definition ?? {},
      })),
      permissionPolicies: policies.map((p) => ({
        name: p.name,
        scope: p.scope,
        role: p.role,
        resourceType: p.resourceType,
        actions: p.actions,
        fieldRestrictions: p.fieldRestrictions ?? null,
        conditions: p.conditions ?? null,
      })),
    };
    const parsed = safeParseSystemDefinition(candidate);
    return parsed.success ? parsed.data : emptySystemDefinition();
  }

  async createDraftVersion(
    systemId: string,
    actorUserId: string,
    changeSummary: string,
    definitionSnapshot: Record<string, unknown>,
    sourcePrompt?: string,
  ) {
    const system = await this.systemsRepository.findOne({
      where: { id: systemId },
    });
    if (!system) {
      throw new NotFoundException('System not found.');
    }

    const latestVersion = await this.versionsRepository.findOne({
      where: { systemId },
      order: { versionNumber: 'DESC' },
    });

    const draftVersion = await this.versionsRepository.save(
      this.versionsRepository.create({
        systemId,
        organizationId: system.organizationId,
        workspaceId: system.workspaceId,
        createdByUserId: actorUserId,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        status: 'draft',
        changeSummary,
        sourcePrompt: sourcePrompt ?? null,
        definitionSnapshot,
        compiledSnapshot: null,
        publishedAt: null,
      }),
    );

    await this.activityService.log({
      organizationId: system.organizationId,
      workspaceId: system.workspaceId,
      systemId: system.id,
      actorUserId,
      action: 'system_version.create_draft',
      targetType: 'system_version',
      targetId: draftVersion.id,
      origin: 'ai',
      metadata: { versionNumber: draftVersion.versionNumber },
    });

    return draftVersion;
  }

  private isPendingStatus(status: string | null | undefined) {
    if (!status) {
      return false;
    }

    return ['pending', 'draft', 'review', 'awaiting_approval'].includes(
      status.toLowerCase(),
    );
  }
}
