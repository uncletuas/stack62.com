import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { SystemControlService } from '../../../shared/system-control/system-control.service';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';

class ToggleDto {
  @IsBoolean()
  enabled!: boolean;
}

class RateLimitDto {
  @IsInt()
  @Min(0)
  @Max(100000)
  perMinute!: number;
}

/**
 * Emergency runtime controls. `system.read` to view; `system.control` to flip
 * maintenance / read-only / rate-limit. Every change is audited. These take
 * effect within ~10s platform-wide without a redeploy.
 */
@ApiTags('admin-system')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/system')
export class AdminSystemController {
  constructor(
    private readonly systemControl: SystemControlService,
    private readonly auditService: AuditService,
  ) {}

  @Get('status')
  @RequireCapability('system.read')
  status() {
    return this.systemControl.getFlags();
  }

  @Post('maintenance')
  @RequireCapability('system.control')
  async maintenance(
    @Body() dto: ToggleDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const flags = await this.systemControl.setMaintenance(dto.enabled);
    await this.audit(actor, 'admin.system.maintenance', { enabled: dto.enabled });
    return flags;
  }

  @Post('read-only')
  @RequireCapability('system.control')
  async readOnly(
    @Body() dto: ToggleDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const flags = await this.systemControl.setReadOnly(dto.enabled);
    await this.audit(actor, 'admin.system.read_only', { enabled: dto.enabled });
    return flags;
  }

  @Post('rate-limit')
  @RequireCapability('system.control')
  async rateLimit(
    @Body() dto: RateLimitDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const flags = await this.systemControl.setRateLimit(dto.perMinute);
    await this.audit(actor, 'admin.system.rate_limit', {
      perMinute: dto.perMinute,
    });
    return flags;
  }

  private audit(
    actor: AuthenticatedStaff,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    return this.auditService.log({
      actorUserId: actor.staffId,
      action,
      targetType: 'system',
      targetId: 'platform',
      origin: 'system',
      metadata: { ...metadata, actorRole: actor.role },
    });
  }
}
