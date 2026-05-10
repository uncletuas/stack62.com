import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { CreateSharePackageDto } from './dto/create-share-package.dto';
import { ListSharePackagesDto } from './dto/list-share-packages.dto';
import { SharePackageEntity } from './entities/share-package.entity';

@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(SharePackageEntity)
    private readonly sharingRepository: Repository<SharePackageEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreateSharePackageDto, actorUserId: string) {
    const sharePackage = this.sharingRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
      createdByUserId: actorUserId,
      name: payload.name,
      mode: payload.mode,
      dataAccessMode: payload.dataAccessMode,
      token: randomUUID(),
      status: 'active',
      expiresAt: payload.expiresAt ?? null,
      config: payload.config ?? null,
    });

    const createdPackage = await this.sharingRepository.save(sharePackage);

    await this.activityService.log({
      organizationId: createdPackage.organizationId,
      workspaceId: createdPackage.workspaceId,
      systemId: createdPackage.systemId,
      actorUserId,
      action: 'share_package.create',
      targetType: 'share_package',
      targetId: createdPackage.id,
      origin: 'user',
      metadata: { mode: createdPackage.mode, token: createdPackage.token },
    });

    await this.auditService.log({
      organizationId: createdPackage.organizationId,
      workspaceId: createdPackage.workspaceId,
      systemId: createdPackage.systemId,
      actorUserId,
      action: 'share_package.create',
      targetType: 'share_package',
      targetId: createdPackage.id,
      afterData: createdPackage,
      metadata: { mode: createdPackage.mode },
    });

    return createdPackage;
  }

  async findAll(filters: ListSharePackagesDto, actorUserId: string) {
    const queryBuilder =
      this.sharingRepository.createQueryBuilder('sharePackage');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'sharePackage',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('sharePackage.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.mode) {
      queryBuilder.andWhere('sharePackage.mode = :mode', {
        mode: filters.mode,
      });
    }

    return queryBuilder.orderBy('sharePackage.createdAt', 'DESC').getMany();
  }
}
