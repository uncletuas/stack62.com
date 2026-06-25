import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ListSchedulesDto } from './dto/list-schedules.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { SchedulesService } from './schedules.service';

@ApiTags('schedule')
@ApiBearerAuth()
@Controller('schedule')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @RequireAccess({
    resource: 'schedule',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post()
  create(@Body() payload: CreateScheduleDto, @CurrentUser() user: JwtUser) {
    return this.schedulesService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'schedule',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListSchedulesDto, @CurrentUser() user: JwtUser) {
    return this.schedulesService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'schedule',
    action: 'update',
    resourceId: { source: 'param', key: 'scheduleId' },
  })
  @Patch(':scheduleId')
  update(
    @Param('scheduleId') scheduleId: string,
    @Body() payload: UpdateScheduleDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.schedulesService.update(scheduleId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'schedule',
    action: 'update',
    resourceId: { source: 'param', key: 'scheduleId' },
  })
  @Delete(':scheduleId')
  delete(
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.schedulesService.delete(scheduleId, user.userId);
  }
}
