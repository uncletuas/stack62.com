import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { ListWorkspacesDto } from './dto/list-workspaces.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @RequireAccess({
    resource: 'workspace',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
  })
  @Post()
  create(@Body() payload: CreateWorkspaceDto, @CurrentUser() user: JwtUser) {
    return this.workspacesService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'workspace',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListWorkspacesDto, @CurrentUser() user: JwtUser) {
    return this.workspacesService.findAll(query, user.userId);
  }
}
