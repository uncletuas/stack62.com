import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { ListBackgroundJobsDto } from './dto/list-background-jobs.dto';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @RequireAccess({
    resource: 'background_job',
    action: 'view_jobs',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListBackgroundJobsDto, @CurrentUser() user: JwtUser) {
    return this.jobsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'background_job',
    action: 'view_jobs',
    resourceId: { source: 'param', key: 'jobId' },
  })
  @Get(':jobId')
  findOne(@Param('jobId') jobId: string) {
    return this.jobsService.findOne(jobId);
  }

  @RequireAccess({
    resource: 'background_job',
    action: 'view_jobs',
    resourceId: { source: 'param', key: 'jobId' },
  })
  @Post(':jobId/cancel')
  cancel(@Param('jobId') jobId: string) {
    return this.jobsService.cancel(jobId);
  }
}
