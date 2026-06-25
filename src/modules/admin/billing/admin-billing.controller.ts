import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminBillingService } from './admin-billing.service';

class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsInt() @Min(0) monthlyPriceCents?: number;
  @IsOptional() @IsInt() @Min(0) yearlyPriceCents?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() maxMembers?: number;
  @IsOptional() @IsInt() monthlyAiRequests?: number;
  @IsOptional() @IsInt() maxActiveSystems?: number;
  @IsOptional() @IsInt() @Min(0) storageGb?: number;
  @IsOptional() @IsInt() maxWorkflows?: number;
  @IsOptional() @IsInt() @Min(0) auditRetentionDays?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

class OverrideSubscriptionDto {
  @IsString() planTier!: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() interval?: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
}

@ApiTags('admin-billing')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(
    private readonly billingService: AdminBillingService,
    private readonly auditService: AuditService,
  ) {}

  @Get('plans')
  @RequireCapability('billing.read')
  listPlans() {
    return this.billingService.listPlans();
  }

  @Post('plans/:id')
  @RequireCapability('billing.edit')
  async updatePlan(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const plan = await this.billingService.updatePlan(id, dto);
    await this.auditService.log({
      actorUserId: actor.staffId,
      action: 'admin.billing.update_plan',
      targetType: 'plan',
      targetId: id,
      origin: 'system',
      metadata: { changes: dto, actorRole: actor.role },
    });
    return plan;
  }

  @Get('subscriptions')
  @RequireCapability('billing.read')
  listSubscriptions() {
    return this.billingService.listSubscriptions();
  }

  @Post('organizations/:id/subscription')
  @RequireCapability('billing.edit')
  async overrideSubscription(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OverrideSubscriptionDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const sub = await this.billingService.overrideSubscription(id, {
      planTier: dto.planTier,
      status: dto.status as never,
      interval: dto.interval as never,
      seats: dto.seats,
    });
    await this.auditService.log({
      actorUserId: actor.staffId,
      action: 'admin.billing.override_subscription',
      targetType: 'subscription',
      targetId: sub.id,
      origin: 'system',
      metadata: { organizationId: id, changes: dto, actorRole: actor.role },
    });
    return sub;
  }
}
