import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminBillingService } from './admin-billing.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('finance_manager', 'executive')
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('subscriptions')
  subscriptions(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.billing.listSubscriptions({
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('revenue')
  revenue() {
    return this.billing.revenueSummary();
  }
}
