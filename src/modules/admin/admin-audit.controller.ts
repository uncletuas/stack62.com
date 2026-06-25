import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/decorators/public.decorator';
import { AdminAuditService } from './admin-audit.service';
import { RequireCapability } from './admin.decorators';
import { ListAdminAuditDto } from './dto/list-admin-audit.dto';
import { PlatformStaffGuard } from './platform-staff.guard';

/**
 * Cross-tenant audit viewer for staff. Requires `audit.read`. @Public() only
 * disables the customer guard; PlatformStaffGuard + the capability check gate it.
 */
@ApiTags('admin-audit')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly adminAuditService: AdminAuditService) {}

  @Get()
  @RequireCapability('audit.read')
  list(@Query() filters: ListAdminAuditDto) {
    return this.adminAuditService.find(filters);
  }

  @Get('export')
  @RequireCapability('audit.read')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  export(@Query() filters: ListAdminAuditDto) {
    return this.adminAuditService.exportCsv(filters);
  }
}
