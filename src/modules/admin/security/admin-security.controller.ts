import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { CurrentStaff, RequireCapability } from '../admin.decorators';
import type { AuthenticatedStaff } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminSecurityService } from './admin-security.service';
import type { IpRuleKind } from '../entities/ip-rule.entity';
import type { IncidentStatus } from '../entities/security-incident.entity';

@ApiTags('admin-security')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly security: AdminSecurityService) {}

  @Get('overview')
  @RequireCapability('security.read')
  overview() {
    return this.security.overview();
  }

  @Get('events')
  @RequireCapability('security.read')
  events() {
    return this.security.events();
  }

  // ── IP rules ──────────────────────────────────────────────────────────
  @Get('ip-rules')
  @RequireCapability('security.read')
  listIpRules() {
    return this.security.listIpRules();
  }

  @Post('ip-rules')
  @RequireCapability('security.edit')
  createIpRule(
    @Body() body: { cidr: string; kind: IpRuleKind; reason?: string | null },
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.security.createIpRule(body, staff.staffId);
  }

  @Delete('ip-rules/:id')
  @RequireCapability('security.edit')
  deleteIpRule(@Param('id') id: string) {
    return this.security.deleteIpRule(id);
  }

  // ── Incidents ─────────────────────────────────────────────────────────
  @Get('incidents')
  @RequireCapability('security.read')
  listIncidents(@Query('status') status?: string) {
    return this.security.listIncidents({ status });
  }

  @Post('incidents')
  @RequireCapability('security.edit')
  createIncident(
    @Body()
    body: {
      title: string;
      detail?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
    },
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.security.createIncident(body, staff.staffId);
  }

  @Post('incidents/:id/status')
  @RequireCapability('security.edit')
  setIncidentStatus(
    @Param('id') id: string,
    @Body() body: { status: IncidentStatus },
  ) {
    return this.security.setIncidentStatus(id, body.status);
  }
}
