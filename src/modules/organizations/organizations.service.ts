import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { slugify } from '../../shared/utils/slugify';
import { OrganizationEntity } from './entities/organization.entity';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizationsRepository: Repository<OrganizationEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
  ) {}

  async create(
    payload: CreateOrganizationDto,
    ownerUserId: string,
  ): Promise<OrganizationEntity> {
    const organization = this.organizationsRepository.create({
      name: payload.name,
      slug: `${slugify(payload.name)}-${Date.now().toString().slice(-6)}`,
      description: payload.description ?? null,
      status: 'active',
      ownerUserId,
    });

    const createdOrganization =
      await this.organizationsRepository.save(organization);

    await this.activityService.log({
      organizationId: createdOrganization.id,
      actorUserId: ownerUserId,
      action: 'organization.create',
      targetType: 'organization',
      targetId: createdOrganization.id,
      origin: 'user',
      metadata: {
        name: createdOrganization.name,
        slug: createdOrganization.slug,
      },
    });

    return createdOrganization;
  }

  async findById(id: string): Promise<OrganizationEntity | null> {
    return this.organizationsRepository.findOne({ where: { id } });
  }

  async updateSettings(
    id: string,
    dto: UpdateOrganizationSettingsDto,
    actorUserId: string,
  ): Promise<OrganizationEntity> {
    const org = await this.organizationsRepository.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found.');

    if (dto.openrouterApiKey !== undefined) {
      org.openrouterApiKey = dto.openrouterApiKey ?? null;
    }
    if (dto.preferredModel !== undefined) {
      org.preferredModel = dto.preferredModel ?? null;
    }

    const saved = await this.organizationsRepository.save(org);

    await this.activityService.log({
      organizationId: id,
      actorUserId,
      action: 'organization.settings.update',
      targetType: 'organization',
      targetId: id,
      origin: 'user',
      metadata: { updatedFields: Object.keys(dto) },
    });

    return saved;
  }

  async findAll(actorUserId: string): Promise<OrganizationEntity[]> {
    const queryBuilder =
      this.organizationsRepository.createQueryBuilder('organization');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'organization',
      actorUserId,
      {
        organizationField: 'id',
      },
    );

    return queryBuilder.orderBy('organization.createdAt', 'DESC').getMany();
  }
}
