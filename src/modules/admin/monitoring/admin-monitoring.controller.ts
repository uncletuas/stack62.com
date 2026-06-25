import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { RequireCapability } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminMonitoringService } from './admin-monitoring.service';

@ApiTags('admin-monitoring')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/monitoring')
export class AdminMonitoringController {
  constructor(private readonly monitoringService: AdminMonitoringService) {}

  @Get('overview')
  @RequireCapability('monitoring.read')
  overview() {
    return this.monitoringService.overview();
  }

  @Get('errors')
  @RequireCapability('monitoring.read')
  errors() {
    return this.monitoringService.errorFeed();
  }

  @Get('failed-jobs')
  @RequireCapability('monitoring.read')
  failedJobs() {
    return this.monitoringService.failedJobs();
  }
}
