import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminInfraService } from './admin-infra.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('engineer')
@Controller('admin/infra')
export class AdminInfraController {
  constructor(private readonly infra: AdminInfraService) {}

  @Get('queues')
  queues() {
    return this.infra.queueHealth();
  }

  @Get('jobs')
  jobs(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.infra.recentJobs({
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
