import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminCustomersService } from './admin-customers.service';

@ApiTags('admin-customers')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(
    private readonly customersService: AdminCustomersService,
    private readonly auditService: AuditService,
  ) {}

  @Get('search')
  @RequireCapability('customer.read')
  search(@Query('q') q: string) {
    return this.customersService.search(q ?? '');
  }

  @Get('organizations/:id')
  @RequireCapability('customer.read')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customersService.getOrganizationDetail(id);
  }

  @Post('organizations/:id/status')
  @RequireCapability('customer.support')
  async setOrgStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body('status') status: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const result = await this.customersService.setOrganizationStatus(
      id,
      status,
    );
    await this.audit(actor, 'admin.customer.org_status', 'organization', id, {
      status,
    });
    return result;
  }

  @Post('users/:id/reset-password')
  @RequireCapability('customer.reset_password')
  async resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const result = await this.customersService.resetUserPassword(id);
    await this.audit(actor, 'admin.customer.reset_password', 'user', id, {});
    return result;
  }

  @Post('users/:id/verify-email')
  @RequireCapability('customer.support')
  async verifyEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const result = await this.customersService.markEmailVerified(id);
    await this.audit(actor, 'admin.customer.verify_email', 'user', id, {});
    return result;
  }

  @Post('users/:id/impersonate')
  @RequireCapability('customer.impersonate')
  async impersonate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const result = await this.customersService.issueImpersonationToken(
      id,
      actor.staffId,
    );
    // High-sensitivity action — audited with the staff actor every time.
    await this.audit(actor, 'admin.customer.impersonate', 'user', id, {
      expiresInSeconds: result.expiresInSeconds,
    });
    return result;
  }

  private audit(
    actor: AuthenticatedStaff,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.auditService.log({
      actorUserId: actor.staffId,
      action,
      targetType,
      targetId,
      origin: 'system',
      metadata: { ...metadata, actorRole: actor.role },
    });
  }
}
