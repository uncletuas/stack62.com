import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { BudgetGovernorService } from './budget-governor.service';
import { ResponseCacheService } from './response-cache.service';

/**
 * Read-only observability for the Organizational Intelligence Layer: how much
 * frontier budget an org has spent, and how much the response cache is saving.
 * Admins/owners use these to confirm cost savings during testing and in prod.
 */
@ApiTags('org-intelligence')
@ApiBearerAuth()
@Controller('org-intelligence')
export class OrgIntelligenceController {
  constructor(
    private readonly budget: BudgetGovernorService,
    private readonly cache: ResponseCacheService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get('budget')
  async getBudget(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertManage(organizationId, user.userId);
    return this.budget.getState(organizationId);
  }

  @Get('cache/stats')
  async cacheStats(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertManage(organizationId, user.userId);
    return this.cache.stats(organizationId);
  }

  @Post('cache/invalidate')
  async invalidate(
    @Body() body: { organizationId: string },
    @CurrentUser() user: JwtUser,
  ) {
    await this.assertManage(body.organizationId, user.userId);
    await this.cache.invalidateOrg(body.organizationId);
    return { ok: true };
  }

  private async assertManage(organizationId: string, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'ai_change_request',
      action: 'manage_ai',
      organizationId,
    });
  }
}
