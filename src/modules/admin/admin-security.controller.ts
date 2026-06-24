import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminSecurityService } from './admin-security.service';
import type { IpRuleKind } from './entities/ip-rule.entity';
import type { IncidentStatus } from './entities/security-incident.entity';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('security_officer')
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly security: AdminSecurityService) {}

  @Get('login-events')
  loginEvents(@Query('limit') limit?: string) {
    return this.security.loginEvents(limit ? Number(limit) : 50);
  }

  // ── IP rules ──────────────────────────────────────────────────────────
  @Get('ip-rules')
  listIpRules() {
    return this.security.listIpRules();
  }

  @Post('ip-rules')
  createIpRule(
    @Body() body: { cidr: string; kind: IpRuleKind; reason?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.security.createIpRule(body, user.userId);
  }

  @Delete('ip-rules/:id')
  deleteIpRule(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.security.deleteIpRule(id, user.userId);
  }

  // ── Incidents ─────────────────────────────────────────────────────────
  @Get('incidents')
  incidents(@Query('status') status?: string) {
    return this.security.listIncidents({ status });
  }

  @Post('incidents/:id/status')
  updateIncident(
    @Param('id') id: string,
    @Body() body: { status: IncidentStatus },
    @CurrentUser() user: JwtUser,
  ) {
    return this.security.updateIncidentStatus(id, body.status, user.userId);
  }
}
