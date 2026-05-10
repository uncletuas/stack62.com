import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { CreatePermissionPolicyDto } from './dto/create-permission-policy.dto';
import { ListPermissionPoliciesDto } from './dto/list-permission-policies.dto';
import { PermissionPolicyEntity } from './entities/permission-policy.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(PermissionPolicyEntity)
    private readonly policiesRepository: Repository<PermissionPolicyEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreatePermissionPolicyDto, actorUserId: string) {
    const policy = this.policiesRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId ?? null,
      systemId: payload.systemId ?? null,
      name: payload.name,
      scope: payload.scope,
      role: payload.role,
      resourceType: payload.resourceType,
      actions: payload.actions,
      fieldRestrictions: payload.fieldRestrictions ?? null,
      conditions: payload.conditions ?? null,
      status: 'active',
    });

    const createdPolicy = await this.policiesRepository.save(policy);

    await this.activityService.log({
      organizationId: createdPolicy.organizationId,
      workspaceId: createdPolicy.workspaceId,
      systemId: createdPolicy.systemId,
      actorUserId,
      action: 'permission_policy.create',
      targetType: 'permission_policy',
      targetId: createdPolicy.id,
      origin: 'user',
      metadata: { role: createdPolicy.role, scope: createdPolicy.scope },
    });

    await this.auditService.log({
      organizationId: createdPolicy.organizationId,
      workspaceId: createdPolicy.workspaceId,
      systemId: createdPolicy.systemId,
      actorUserId,
      action: 'permission_policy.create',
      targetType: 'permission_policy',
      targetId: createdPolicy.id,
      afterData: createdPolicy,
      metadata: { role: createdPolicy.role },
    });

    return createdPolicy;
  }

  async findAll(filters: ListPermissionPoliciesDto, actorUserId: string) {
    const queryBuilder = this.policiesRepository.createQueryBuilder('policy');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'policy',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('policy.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.role) {
      queryBuilder.andWhere('policy.role = :role', { role: filters.role });
    }

    return queryBuilder.orderBy('policy.createdAt', 'DESC').getMany();
  }
}
