import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { BillingService } from './billing.service';
import { StartCheckoutDto } from './dto/start-checkout.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Public — used by the landing/pricing page before sign-up. Returns
   * only the published plans, no per-org context.
   */
  @Public()
  @Get('plans')
  listPlans() {
    return this.billingService.listPublishedPlans();
  }

  @ApiBearerAuth()
  @Get('summary')
  summary(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.billingService.fetchOrgSummary(organizationId, user.userId);
  }

  @ApiBearerAuth()
  @Post('checkout')
  startCheckout(@Body() body: StartCheckoutDto, @CurrentUser() user: JwtUser) {
    return this.billingService.startCheckout({
      organizationId: body.organizationId,
      actorUserId: user.userId,
      targetTier: body.targetTier,
      interval: body.interval ?? 'monthly',
      seats: body.seats ?? 1,
    });
  }
}
