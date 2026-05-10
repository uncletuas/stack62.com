import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateSystemDto } from './dto/create-system.dto';
import { ListSystemsDto } from './dto/list-systems.dto';
import { PublishSystemVersionDto } from './dto/publish-system-version.dto';
import { RollbackSystemVersionDto } from './dto/rollback-system-version.dto';
import { SystemsService } from './systems.service';

@ApiTags('systems')
@ApiBearerAuth()
@Controller('systems')
export class SystemsController {
  constructor(private readonly systemsService: SystemsService) {}

  @RequireAccess({
    resource: 'system',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
  })
  @Post()
  create(@Body() payload: CreateSystemDto, @CurrentUser() user: JwtUser) {
    return this.systemsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListSystemsDto, @CurrentUser() user: JwtUser) {
    return this.systemsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'read',
    resourceId: { source: 'param', key: 'systemId' },
  })
  @Get(':systemId')
  findOne(@Param('systemId') systemId: string) {
    return this.systemsService.findOne(systemId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'update',
    resourceId: { source: 'param', key: 'systemId' },
  })
  @Delete(':systemId')
  delete(@Param('systemId') systemId: string, @CurrentUser() user: JwtUser) {
    return this.systemsService.delete(systemId, user.userId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'read',
    resourceId: { source: 'param', key: 'systemId' },
  })
  @Get(':systemId/versions')
  findVersions(@Param('systemId') systemId: string) {
    return this.systemsService.findVersions(systemId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'publish',
    resourceId: { source: 'param', key: 'systemId' },
  })
  @Post(':systemId/publish')
  publish(
    @Param('systemId') systemId: string,
    @Body() payload: PublishSystemVersionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.systemsService.publish(systemId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'system',
    action: 'publish',
    resourceId: { source: 'param', key: 'systemId' },
  })
  @Post(':systemId/versions/:versionId/rollback')
  rollback(
    @Param('systemId') systemId: string,
    @Param('versionId') versionId: string,
    @Body() payload: RollbackSystemVersionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.systemsService.publish(
      systemId,
      {
        rollbackToVersionId: versionId,
        changeSummary: payload.reason,
      },
      user.userId,
    );
  }
}
