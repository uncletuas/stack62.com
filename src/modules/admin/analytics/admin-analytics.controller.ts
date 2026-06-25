import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { RequireCapability } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminAnalyticsService } from './admin-analytics.service';

@ApiTags('admin-analytics')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @Get('overview')
  @RequireCapability('monitoring.read')
  overview() {
    return this.analyticsService.overview();
  }

  @Get('growth')
  @RequireCapability('monitoring.read')
  growth(@Query('days') days?: string) {
    const parsed = Number(days);
    return this.analyticsService.growth(
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 90,
    );
  }

  @Get('revenue')
  @RequireCapability('monitoring.read')
  revenue() {
    return this.analyticsService.revenue();
  }

  @Get('regions')
  @RequireCapability('monitoring.read')
  regions() {
    return this.analyticsService.regions();
  }
}
