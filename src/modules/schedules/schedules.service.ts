import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ListSchedulesDto } from './dto/list-schedules.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleEntity } from './entities/schedule.entity';

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(ScheduleEntity)
    private readonly schedulesRepository: Repository<ScheduleEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
  ) {}

  async create(payload: CreateScheduleDto, actorUserId: string) {
    const schedule = this.schedulesRepository.create({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId ?? null,
      taskId: payload.taskId ?? null,
      recordId: payload.recordId ?? null,
      createdByUserId: actorUserId,
      title: payload.title,
      kind: payload.kind,
      status: 'scheduled',
      startsAt: payload.startsAt,
      endsAt: payload.endsAt ?? null,
      recurrenceRule: payload.recurrenceRule ?? null,
      metadata: payload.metadata ?? null,
    });

    const createdSchedule = await this.schedulesRepository.save(schedule);

    await this.activityService.log({
      organizationId: createdSchedule.organizationId,
      workspaceId: createdSchedule.workspaceId,
      systemId: createdSchedule.systemId,
      actorUserId,
      action: 'schedule.create',
      targetType: 'schedule',
      targetId: createdSchedule.id,
      origin: 'user',
      metadata: { kind: createdSchedule.kind },
    });

    await this.auditService.log({
      organizationId: createdSchedule.organizationId,
      workspaceId: createdSchedule.workspaceId,
      systemId: createdSchedule.systemId,
      actorUserId,
      action: 'schedule.create',
      targetType: 'schedule',
      targetId: createdSchedule.id,
      afterData: createdSchedule,
    });

    return createdSchedule;
  }

  async findAll(filters: ListSchedulesDto, actorUserId: string) {
    const queryBuilder =
      this.schedulesRepository.createQueryBuilder('schedule');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'schedule',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('schedule.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.status) {
      queryBuilder.andWhere('schedule.status = :status', {
        status: filters.status,
      });
    }

    return queryBuilder.orderBy('schedule.startsAt', 'ASC').take(200).getMany();
  }

  async update(
    scheduleId: string,
    payload: UpdateScheduleDto,
    actorUserId: string,
  ) {
    const schedule = await this.schedulesRepository.findOne({
      where: { id: scheduleId },
    });
    if (!schedule) {
      throw new NotFoundException('Schedule not found.');
    }

    const beforeData = { ...schedule };
    schedule.systemId = payload.systemId ?? schedule.systemId;
    schedule.taskId = payload.taskId ?? schedule.taskId;
    schedule.recordId = payload.recordId ?? schedule.recordId;
    schedule.title = payload.title ?? schedule.title;
    schedule.kind = payload.kind ?? schedule.kind;
    schedule.status = payload.status ?? schedule.status;
    schedule.startsAt = payload.startsAt ?? schedule.startsAt;
    schedule.endsAt = Object.prototype.hasOwnProperty.call(payload, 'endsAt')
      ? (payload.endsAt ?? null)
      : schedule.endsAt;
    schedule.recurrenceRule = Object.prototype.hasOwnProperty.call(
      payload,
      'recurrenceRule',
    )
      ? (payload.recurrenceRule ?? null)
      : schedule.recurrenceRule;
    schedule.metadata = Object.prototype.hasOwnProperty.call(
      payload,
      'metadata',
    )
      ? (payload.metadata ?? null)
      : schedule.metadata;

    const updatedSchedule = await this.schedulesRepository.save(schedule);

    await this.activityService.log({
      organizationId: updatedSchedule.organizationId,
      workspaceId: updatedSchedule.workspaceId,
      systemId: updatedSchedule.systemId,
      actorUserId,
      action: 'schedule.update',
      targetType: 'schedule',
      targetId: updatedSchedule.id,
      origin: 'user',
      metadata: { status: updatedSchedule.status },
    });

    await this.auditService.log({
      organizationId: updatedSchedule.organizationId,
      workspaceId: updatedSchedule.workspaceId,
      systemId: updatedSchedule.systemId,
      actorUserId,
      action: 'schedule.update',
      targetType: 'schedule',
      targetId: updatedSchedule.id,
      beforeData: beforeData as unknown as Record<string, unknown>,
      afterData: updatedSchedule,
    });

    return updatedSchedule;
  }

  /**
   * Flag/unflag a schedule as Coworker-handled. Called from the
   * schedules.create Coworker tool right after creation — the
   * standard CreateScheduleDto doesn't yet expose this field so it
   * comes through a dedicated mutator.
   */
  async markAssignedToCoworker(
    scheduleId: string,
    assigned: boolean,
  ): Promise<void> {
    await this.schedulesRepository.update(
      { id: scheduleId },
      { assignedToCoworker: assigned },
    );
  }

  async delete(scheduleId: string, actorUserId: string) {
    const schedule = await this.schedulesRepository.findOne({
      where: { id: scheduleId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found.');

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'schedule',
      action: 'update',
      organizationId: schedule.organizationId,
      workspaceId: schedule.workspaceId,
      systemId: schedule.systemId ?? undefined,
      ownerUserId: schedule.createdByUserId,
    });

    const beforeData = { ...schedule };
    schedule.status = 'cancelled';
    const deleted = await this.schedulesRepository.save(schedule);

    await this.activityService.log({
      organizationId: deleted.organizationId,
      workspaceId: deleted.workspaceId,
      systemId: deleted.systemId,
      actorUserId,
      action: 'schedule.delete',
      targetType: 'schedule',
      targetId: deleted.id,
      origin: 'user',
      metadata: { title: deleted.title },
    });

    await this.auditService.log({
      organizationId: deleted.organizationId,
      workspaceId: deleted.workspaceId,
      systemId: deleted.systemId,
      actorUserId,
      action: 'schedule.delete',
      targetType: 'schedule',
      targetId: deleted.id,
      beforeData,
      afterData: deleted,
    });

    return deleted;
  }
}
