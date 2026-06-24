import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
// Entities owned by other modules but read cross-tenant by the Assembly.
import { UserEntity } from '../users/entities/user.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { SubscriptionEntity } from '../billing/entities/subscription.entity';
import { PlanEntity } from '../billing/entities/plan.entity';
import { AiRequestLogEntity } from '../ai/entities/ai-request-log.entity';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BackgroundJobEntity } from '../jobs/entities/background-job.entity';
import { IntegrationConnectionEntity } from '../integrations/entities/integration-connection.entity';
// Entities owned by the Assembly.
import { SupportTicketEntity } from './entities/support-ticket.entity';
import { AnnouncementEntity } from './entities/announcement.entity';
import { PlatformConfigEntity } from './entities/platform-config.entity';
import { IpRuleEntity } from './entities/ip-rule.entity';
import { SecurityIncidentEntity } from './entities/security-incident.entity';
// Services.
import { AdminService } from './admin.service';
import { AdminUsersService } from './admin-users.service';
import { AdminOrgsService } from './admin-orgs.service';
import { AdminBillingService } from './admin-billing.service';
import { AdminAiService } from './admin-ai.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminIntegrationsService } from './admin-integrations.service';
import { AdminInfraService } from './admin-infra.service';
import { AdminSecurityService } from './admin-security.service';
import { AdminSupportService } from './admin-support.service';
import { AdminContentService } from './admin-content.service';
import { AdminConfigService } from './admin-config.service';
// Controllers.
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminOrgsController } from './admin-orgs.controller';
import { AdminBillingController } from './admin-billing.controller';
import { AdminAiController } from './admin-ai.controller';
import { AdminAuditController } from './admin-audit.controller';
import { AdminIntegrationsController } from './admin-integrations.controller';
import { AdminInfraController } from './admin-infra.controller';
import { AdminSecurityController } from './admin-security.controller';
import { AdminSupportController } from './admin-support.controller';
import { AdminContentController } from './admin-content.controller';
import { AdminConfigController } from './admin-config.controller';

/**
 * The Stack62 "Assembly" — the platform administrative backend. Every route
 * lives under `/v1/admin/*` and is gated by PlatformRoleGuard
 * (@PlatformRoles). Reads here are cross-tenant by design; the tenant
 * AccessControl layer does not apply.
 */
@Module({
  imports: [
    AuditModule, // AuditService — every admin write is recorded.
    TypeOrmModule.forFeature([
      UserEntity,
      OrganizationEntity,
      MembershipEntity,
      SubscriptionEntity,
      PlanEntity,
      AiRequestLogEntity,
      AuditLogEntity,
      BackgroundJobEntity,
      IntegrationConnectionEntity,
      SupportTicketEntity,
      AnnouncementEntity,
      PlatformConfigEntity,
      IpRuleEntity,
      SecurityIncidentEntity,
    ]),
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminOrgsController,
    AdminBillingController,
    AdminAiController,
    AdminAuditController,
    AdminIntegrationsController,
    AdminInfraController,
    AdminSecurityController,
    AdminSupportController,
    AdminContentController,
    AdminConfigController,
  ],
  providers: [
    AdminService,
    AdminUsersService,
    AdminOrgsService,
    AdminBillingService,
    AdminAiService,
    AdminAuditService,
    AdminIntegrationsService,
    AdminInfraService,
    AdminSecurityService,
    AdminSupportService,
    AdminContentService,
    AdminConfigService,
  ],
})
export class AdminModule {}
