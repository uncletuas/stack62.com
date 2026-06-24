import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminOrgsService } from './admin-orgs.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('support_manager', 'operations_manager', 'finance_manager')
@Controller('admin/organizations')
export class AdminOrgsController {
  constructor(private readonly orgs: AdminOrgsService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orgs.list({
      search,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':orgId')
  get(@Param('orgId') orgId: string) {
    return this.orgs.get(orgId);
  }

  @PlatformRoles('operations_manager')
  @Post(':orgId/status')
  setStatus(
    @Param('orgId') orgId: string,
    @Body() body: { status: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.orgs.setStatus(orgId, body.status, user.userId);
  }
}
