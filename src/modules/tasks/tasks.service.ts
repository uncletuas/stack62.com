import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskEntity } from './entities/task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreateTaskDto, actorUserId: string) {
    const task = this.tasksRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId ?? null,
      recordId: payload.recordId ?? null,
      createdByUserId: actorUserId,
      assigneeUserId: payload.assigneeUserId ?? null,
      title: payload.title,
      description: payload.description ?? null,
      status: 'todo',
      priority: payload.priority ?? 'medium',
      dueAt: payload.dueAt ?? null,
      metadata: payload.metadata ?? null,
    });

    const createdTask = await this.tasksRepository.save(task);

    await this.activityService.log({
      organizationId: createdTask.organizationId,
      workspaceId: createdTask.workspaceId,
      systemId: createdTask.systemId,
      actorUserId,
      action: 'task.create',
      targetType: 'task',
      targetId: createdTask.id,
      origin: 'user',
      metadata: { status: createdTask.status, priority: createdTask.priority },
    });

    await this.auditService.log({
      organizationId: createdTask.organizationId,
      workspaceId: createdTask.workspaceId,
      systemId: createdTask.systemId,
      actorUserId,
      action: 'task.create',
      targetType: 'task',
      targetId: createdTask.id,
      afterData: createdTask,
    });

    return createdTask;
  }

  async findAll(filters: ListTasksDto, actorUserId: string) {
    const queryBuilder = this.tasksRepository.createQueryBuilder('task');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'task',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('task.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.assigneeUserId) {
      queryBuilder.andWhere('task.assigneeUserId = :assigneeUserId', {
        assigneeUserId: filters.assigneeUserId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('task.status = :status', {
        status: filters.status,
      });
    }

    return queryBuilder.orderBy('task.createdAt', 'DESC').take(200).getMany();
  }

  async update(taskId: string, payload: UpdateTaskDto, actorUserId: string) {
    const task = await this.tasksRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found.');
    }

    const beforeData = { ...task };
    task.assigneeUserId = payload.assigneeUserId ?? task.assigneeUserId;
    task.status = payload.status ?? task.status;
    task.priority = payload.priority ?? task.priority;
    task.dueAt = payload.dueAt ?? task.dueAt;
    task.metadata = payload.metadata ?? task.metadata;

    const updatedTask = await this.tasksRepository.save(task);

    await this.activityService.log({
      organizationId: updatedTask.organizationId,
      workspaceId: updatedTask.workspaceId,
      systemId: updatedTask.systemId,
      actorUserId,
      action: 'task.update',
      targetType: 'task',
      targetId: updatedTask.id,
      origin: 'user',
      metadata: { status: updatedTask.status },
    });

    await this.auditService.log({
      organizationId: updatedTask.organizationId,
      workspaceId: updatedTask.workspaceId,
      systemId: updatedTask.systemId,
      actorUserId,
      action: 'task.update',
      targetType: 'task',
      targetId: updatedTask.id,
      beforeData: beforeData as unknown as Record<string, unknown>,
      afterData: updatedTask,
    });

    return updatedTask;
  }
}
