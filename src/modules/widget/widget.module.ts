import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { EngineModule } from '../engine/engine.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { OrgIntelligenceModule } from '../org-intelligence/org-intelligence.module';
import { SemanticSearchModule } from '../semantic-search/semantic-search.module';
import { WidgetTokenEntity } from './entities/widget-token.entity';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';

/**
 * Embeddable website assistant. Orgs mint scoped public tokens and drop a
 * <script> tag on their site; visitors chat with an assistant grounded only in
 * the org's curated knowledge base (and optionally its indexed documents) —
 * no CRM access, no write actions. Reuses the local-first LLM stack so most
 * answers are $0.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([WidgetTokenEntity]),
    AccessControlModule,
    EngineModule,
    OrganizationsModule,
    OrgIntelligenceModule,
    SemanticSearchModule,
  ],
  controllers: [WidgetController],
  providers: [WidgetService],
  exports: [WidgetService],
})
export class WidgetModule {}
