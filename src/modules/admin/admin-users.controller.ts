import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminUsersService } from './admin-users.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @PlatformRoles('support_manager', 'operations_manager', 'security_officer')
  @Get('users')
  list(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('platformRole') platformRole?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.list({
      search,
      status,
      platformRole,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @PlatformRoles('support_manager', 'operations_manager', 'security_officer')
  @Get('users/:userId')
  get(@Param('userId') userId: string) {
    return this.users.get(userId);
  }

  @PlatformRoles('support_manager', 'operations_manager', 'security_officer')
  @Post('users/:userId/suspend')
  suspend(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.users.setStatus(userId, 'suspended', user.userId);
  }

  @PlatformRoles('support_manager', 'operations_manager', 'security_officer')
  @Post('users/:userId/activate')
  activate(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.users.setStatus(userId, 'active', user.userId);
  }

  @PlatformRoles('support_manager', 'operations_manager')
  @Post('users/:userId/verify-email')
  verify(@Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.users.verifyEmail(userId, user.userId);
  }

  // ── Roles / RBAC admin (super_admin + security_officer only) ────────────
  @PlatformRoles('security_officer')
  @Get('roles/staff')
  staff() {
    return this.users.listStaff();
  }

  @PlatformRoles('security_officer')
  @Post('roles/:userId')
  setRole(
    @Param('userId') userId: string,
    @Body() body: { platformRole: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.users.setPlatformRole(userId, body.platformRole, user.userId);
  }
}
