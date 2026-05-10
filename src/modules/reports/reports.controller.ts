import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import {
  CreateReportDto,
  GenerateReportDto,
  ListReportsDto,
  UpdateReportDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @RequireAccess({
    resource: 'report',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get()
  findAll(@Query() query: ListReportsDto, @CurrentUser() user: JwtUser) {
    return this.reportsService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'read',
    resourceId: { source: 'param', key: 'reportId' },
  })
  @Get(':reportId')
  findOne(@Param('reportId') reportId: string, @CurrentUser() user: JwtUser) {
    return this.reportsService.findOne(reportId, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post()
  create(@Body() payload: CreateReportDto, @CurrentUser() user: JwtUser) {
    return this.reportsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'create',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post('generate')
  generate(@Body() payload: GenerateReportDto, @CurrentUser() user: JwtUser) {
    return this.reportsService.generate(payload, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'update',
    resourceId: { source: 'param', key: 'reportId' },
  })
  @Patch(':reportId')
  update(
    @Param('reportId') reportId: string,
    @Body() payload: UpdateReportDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.reportsService.update(reportId, payload, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'update',
    resourceId: { source: 'param', key: 'reportId' },
  })
  @Delete(':reportId')
  archive(@Param('reportId') reportId: string, @CurrentUser() user: JwtUser) {
    return this.reportsService.archive(reportId, user.userId);
  }

  @RequireAccess({
    resource: 'report',
    action: 'create',
    resourceId: { source: 'param', key: 'reportId' },
  })
  @Post(':reportId/save-document')
  saveAsDocument(
    @Param('reportId') reportId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.reportsService.saveAsDocument(reportId, user.userId);
  }
}
