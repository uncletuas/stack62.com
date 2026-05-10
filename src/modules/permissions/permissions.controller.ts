import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreatePermissionPolicyDto } from './dto/create-permission-policy.dto';
import { ListPermissionPoliciesDto } from './dto/list-permission-policies.dto';
import { PermissionsService } from './permissions.service';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @RequireAccess({
    resource: 'permission_policy',
    action: 'manage_permissions',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post('policies')
  create(
    @Body() payload: CreatePermissionPolicyDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.permissionsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'permission_policy',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('policies')
  findAll(
    @Query() query: ListPermissionPoliciesDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.permissionsService.findAll(query, user.userId);
  }
}
