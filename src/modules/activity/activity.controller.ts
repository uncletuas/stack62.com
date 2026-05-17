import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { ListActivityDto } from './dto/list-activity.dto';
import { DashboardQueryDto } from './dto/dashboard.dto';

@ApiTags('activity')
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  findAll(@Query() query: ListActivityDto) {
    return this.activityService.findAll(query);
  }

  @Get('dashboard')
  getDashboard(@Query() query: DashboardQueryDto) {
    const { organizationId = '', workspaceId = '' } = query;
    return this.activityService.getDashboard(organizationId, workspaceId);
  }
}
