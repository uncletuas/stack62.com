import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminAuditService, type AdminAuditQuery } from './admin-audit.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('security_officer', 'finance_manager')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(@Query() query: AdminAuditQuery) {
    return this.audit.list({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stack62-admin-audit.csv"')
  exportCsv(@Query() query: AdminAuditQuery) {
    return this.audit.exportCsv(query);
  }
}
