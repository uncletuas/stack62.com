import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from './admin.decorators';
import {
  CreateStaffDto,
  UpdateStaffRoleDto,
  UpdateStaffStatusDto,
} from './dto/manage-staff.dto';
import { PlatformStaffGuard } from './platform-staff.guard';
import { PlatformStaffService } from './platform-staff.service';
import { ROLE_CAPABILITIES } from './platform-staff.constants';

/**
 * Staff administration. @Public() bypasses the global customer guard;
 * PlatformStaffGuard is the real gate. Listing needs `staff.read`; all
 * mutations need `staff.manage` (super_admin only by default). Every mutation
 * is written to the audit log.
 */
@ApiTags('admin-staff')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(
    private readonly staffService: PlatformStaffService,
    private readonly auditService: AuditService,
  ) {}

  /** The role → capability matrix, so the UI can explain each position. */
  @Get('roles')
  @RequireCapability('staff.read')
  roles() {
    return ROLE_CAPABILITIES;
  }

  @Get()
  @RequireCapability('staff.read')
  async list() {
    const staff = await this.staffService.list();
    return staff.map((s) => this.staffService.sanitize(s));
  }

  @Post()
  @RequireCapability('staff.manage')
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const created = await this.staffService.create({
      ...dto,
      mustResetPassword: true,
      createdByStaffId: actor.staffId,
    });
    await this.audit(actor, 'admin.staff.create', created.id, {
      email: created.email,
      role: created.role,
    });
    return this.staffService.sanitize(created);
  }

  @Post(':id/role')
  @RequireCapability('staff.manage')
  async setRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStaffRoleDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const updated = await this.staffService.setRole(id, dto.role);
    await this.audit(actor, 'admin.staff.set_role', id, { role: dto.role });
    return this.staffService.sanitize(updated);
  }

  @Post(':id/status')
  @RequireCapability('staff.manage')
  async setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const updated = await this.staffService.setStatus(id, dto.status);
    await this.audit(actor, 'admin.staff.set_status', id, {
      status: dto.status,
    });
    return this.staffService.sanitize(updated);
  }

  @Post(':id/force-password-reset')
  @RequireCapability('staff.manage')
  async forcePasswordReset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const updated = await this.staffService.forcePasswordReset(id);
    await this.audit(actor, 'admin.staff.force_password_reset', id, {});
    return this.staffService.sanitize(updated);
  }

  @Post(':id/reset-2fa')
  @RequireCapability('staff.manage')
  async resetTwoFactor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const updated = await this.staffService.resetTwoFactor(id);
    await this.audit(actor, 'admin.staff.reset_2fa', id, {});
    return this.staffService.sanitize(updated);
  }

  private audit(
    actor: AuthenticatedStaff,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.auditService.log({
      actorUserId: actor.staffId,
      action,
      targetType: 'platform_staff',
      targetId,
      origin: 'system',
      metadata: { ...metadata, actorRole: actor.role },
    });
  }
}
