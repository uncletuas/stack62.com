import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import {
  ActivityLogEntity,
  ActivityOrigin,
} from './entities/activity-log.entity';
import { ListActivityDto } from './dto/list-activity.dto';
import { AiChangeRequestEntity } from '../ai/entities/ai-change-request.entity';
import { WorkflowRunEntity } from '../workflows/entities/workflow-run.entity';

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

export interface WorkspaceDashboard {
  pendingAiRequests: number;
  activeWorkflowRuns: number;
  aiHandledToday: number;
  recentActivity: ActivityLogEntity[];
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityLogEntity)
    private readonly activityRepository: Repository<ActivityLogEntity>,
    @InjectRepository(AiChangeRequestEntity)
    private readonly aiRequestRepository: Repository<AiChangeRequestEntity>,
    @InjectRepository(WorkflowRunEntity)
    private readonly workflowRunRepository: Repository<WorkflowRunEntity>,
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
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async getDashboard(
    organizationId: string,
    workspaceId: string,
  ): Promise<WorkspaceDashboard> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      pendingAiRequests,
      activeWorkflowRuns,
      aiHandledToday,
      recentActivity,
    ] = await Promise.all([
      this.aiRequestRepository.count({
        where: [
          { workspaceId, status: 'queued' as any },
          { workspaceId, status: 'processing' as any },
        ],
      }),
      this.workflowRunRepository.count({
        where: { workspaceId, status: 'active' },
      }),
      this.activityRepository.count({
        where: {
          workspaceId,
          origin: 'ai',
          createdAt: MoreThanOrEqual(todayStart) as any,
        },
      }),
      this.activityRepository.find({
        where: { organizationId, workspaceId },
        order: { createdAt: 'DESC' },
        take: 8,
      }),
    ]);

    return {
      pendingAiRequests,
      activeWorkflowRuns,
      aiHandledToday,
      recentActivity,
    };
  }
}
