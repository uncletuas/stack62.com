import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ActivityLogEntity,
  ActivityOrigin,
} from './entities/activity-log.entity';
import { ListActivityDto } from './dto/list-activity.dto';

export interface CreateActivityLogInput {
  organizationId?: string | null;
  workspaceId?: string | null;
  systemId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  origin?: ActivityOrigin;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityLogEntity)
    private readonly activityRepository: Repository<ActivityLogEntity>,
  ) {}

  async log(input: CreateActivityLogInput): Promise<ActivityLogEntity> {
    const activity = this.activityRepository.create({
      organizationId: input.organizationId ?? null,
      workspaceId: input.workspaceId ?? null,
      systemId: input.systemId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      origin: input.origin ?? 'user',
      metadata: input.metadata ?? null,
    });

    return this.activityRepository.save(activity);
  }

  async findAll(filters: ListActivityDto): Promise<ActivityLogEntity[]> {
    return this.activityRepository.find({
      where: {
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
        systemId: filters.systemId,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 100,
    });
  }
}
