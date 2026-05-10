import {
  Body,
  Controller,
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
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @RequireAccess({
    resource: 'task',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post()
  create(@Body() payload: CreateTaskDto, @CurrentUser() user: JwtUser) {
    return this.tasksService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'task',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListTasksDto, @CurrentUser() user: JwtUser) {
    return this.tasksService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'task',
    action: 'update',
    resourceId: { source: 'param', key: 'taskId' },
  })
  @Patch(':taskId')
  update(
    @Param('taskId') taskId: string,
    @Body() payload: UpdateTaskDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.tasksService.update(taskId, payload, user.userId);
  }
}
