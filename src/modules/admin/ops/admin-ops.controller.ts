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
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import type { OpsRequestType } from '../entities/ops-request.entity';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminOpsService } from './admin-ops.service';

class CreateOpsRequestDto {
  @IsIn(['run_migrations', 'rotate_secret', 'custom_trigger'])
  type!: OpsRequestType;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Approval-gated engineering ops. Creating a request needs the matching
 * engineering capability; deciding it needs `approvals.approve` AND a different
 * staff member than the requester (enforced in the service). Migrations also
 * require a super_admin approver.
 */
@ApiTags('admin-ops')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/ops')
export class AdminOpsController {
  constructor(
    private readonly opsService: AdminOpsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('triggers')
  @RequireCapability('engineering.trigger')
  triggers() {
    return this.opsService.knownTriggers();
  }

  @Get()
  @RequireCapability('engineering.trigger')
  list(@Query('status') status?: string) {
    return this.opsService.list(status);
  }

  @Post()
  @RequireCapability('engineering.trigger')
  async create(
    @Body() dto: CreateOpsRequestDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const request = await this.opsService.createRequest(
      { staffId: actor.staffId, role: actor.role },
      dto.type,
      dto.payload ?? null,
      dto.reason ?? null,
    );
    await this.audit(actor, 'admin.ops.request', request.id, {
      type: dto.type,
    });
    return request;
  }

  @Post(':id/approve')
  @RequireCapability('approvals.approve')
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const request = await this.opsService.approveAndExecute(
      { staffId: actor.staffId, role: actor.role },
      id,
    );
    await this.audit(actor, 'admin.ops.approve', id, {
      type: request.type,
      outcome: request.status,
    });
    return request;
  }

  @Post(':id/reject')
  @RequireCapability('approvals.approve')
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const request = await this.opsService.reject(
      { staffId: actor.staffId, role: actor.role },
      id,
    );
    await this.audit(actor, 'admin.ops.reject', id, { type: request.type });
    return request;
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
      targetType: 'ops_request',
      targetId,
      origin: 'system',
      metadata: { ...metadata, actorRole: actor.role },
    });
  }
}
