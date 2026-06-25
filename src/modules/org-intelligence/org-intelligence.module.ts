import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SemanticSearchModule } from '../semantic-search/semantic-search.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { AiResponseCacheEntity } from './entities/ai-response-cache.entity';
import { AiSpendCounterEntity } from './entities/ai-spend-counter.entity';
import { BudgetGovernorService } from './budget-governor.service';
import { OrgContextService } from './org-context.service';
import { ResponseCacheService } from './response-cache.service';
import { OrgIntelligenceMaintenanceService } from './org-intelligence-maintenance.service';
import { OrgIntelligenceController } from './org-intelligence.controller';

/**
 * The Organizational Intelligence Layer (OIL).
 *
 * Coordination services that sit in front of the engine to cut frontier API
 * spend and make the coworker organizationally aware:
 *   - ResponseCacheService — semantic replay of prior local/read-only
 *     resolutions at $0 (this module, milestone 1b).
 *   - OrgContextService / BudgetGovernorService — added in later milestones.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiResponseCacheEntity, AiSpendCounterEntity]),
    SemanticSearchModule,
    IntegrationsModule,
    MembershipsModule,
    SchedulesModule,
    AccessControlModule,
  ],
  controllers: [OrgIntelligenceController],
  providers: [
    ResponseCacheService,
    BudgetGovernorService,
    OrgContextService,
    OrgIntelligenceMaintenanceService,
  ],
  exports: [ResponseCacheService, BudgetGovernorService, OrgContextService],
})
export class OrgIntelligenceModule {}
