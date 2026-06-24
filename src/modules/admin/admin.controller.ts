import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { modulesForRole } from '../../shared/access-control/platform-roles';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles()
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** Identity + module access for the Assembly gate and nav. */
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    const role = user.platformRole!; // guard guarantees non-null
    return {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: role,
      modules: modulesForRole(role),
    };
  }

  @Get('dashboard/overview')
  dashboardOverview() {
    return this.adminService.dashboardOverview();
  }

  @PlatformRoles('executive', 'finance_manager')
  @Get('executive/kpis')
  executiveKpis() {
    return this.adminService.executiveKpis();
  }

  @Get('observability/snapshot')
  observability() {
    return this.adminService.observabilitySnapshot();
  }

  @Get('activity')
  activity(@Query('limit') limit?: string) {
    return this.adminService.activityFeed(limit ? Number(limit) : 50);
  }
}
