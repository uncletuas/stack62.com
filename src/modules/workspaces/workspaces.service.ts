import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { slugify } from '../../shared/utils/slugify';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { ListWorkspacesDto } from './dto/list-workspaces.dto';
import { WorkspaceEntity } from './entities/workspace.entity';

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspacesRepository: Repository<WorkspaceEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
  ) {}

  async create(payload: CreateWorkspaceDto, actorUserId: string) {
    const workspace = this.workspacesRepository.create({
      organizationId: payload.organizationId,
      name: payload.name,
      slug: `${slugify(payload.name)}-${Date.now().toString().slice(-6)}`,
      description: payload.description ?? null,
      status: 'active',
    });

    const createdWorkspace = await this.workspacesRepository.save(workspace);

    await this.activityService.log({
      organizationId: createdWorkspace.organizationId,
      workspaceId: createdWorkspace.id,
      actorUserId,
      action: 'workspace.create',
      targetType: 'workspace',
      targetId: createdWorkspace.id,
      origin: 'user',
      metadata: { name: createdWorkspace.name, slug: createdWorkspace.slug },
    });

    return createdWorkspace;
  }

  async findAll(filters: ListWorkspacesDto, actorUserId: string) {
    const queryBuilder =
      this.workspacesRepository.createQueryBuilder('workspace');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'workspace',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'id',
        organizationId: filters.organizationId,
      },
    );

    return queryBuilder.orderBy('workspace.createdAt', 'DESC').getMany();
  }
}
