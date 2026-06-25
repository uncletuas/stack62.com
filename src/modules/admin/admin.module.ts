import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { PaymentTransactionEntity } from '../billing/entities/payment-transaction.entity';
import { PlanEntity } from '../billing/entities/plan.entity';
import { SubscriptionEntity } from '../billing/entities/subscription.entity';
import { UsageCounterEntity } from '../billing/entities/usage-counter.entity';
import { BackgroundJobEntity } from '../jobs/entities/background-job.entity';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { UserEntity } from '../users/entities/user.entity';
import { AiRequestLogEntity } from '../ai/entities/ai-request-log.entity';
import { IntegrationConnectionEntity } from '../integrations/entities/integration-connection.entity';
import { WebhookEventEntity } from '../integrations/entities/webhook-event.entity';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminStaffController } from './admin-staff.controller';
import { AdminBillingController } from './billing/admin-billing.controller';
import { AdminBillingService } from './billing/admin-billing.service';
import { AdminConfigController } from './settings/admin-config.controller';
import { AdminCustomersController } from './customers/admin-customers.controller';
import { AdminDatabaseController } from './database/admin-database.controller';
import { AdminDatabaseService } from './database/admin-database.service';
import { AdminSystemController } from './system/admin-system.controller';
import { AdminCustomersService } from './customers/admin-customers.service';
import { AdminMonitoringController } from './monitoring/admin-monitoring.controller';
import { AdminMonitoringService } from './monitoring/admin-monitoring.service';
import { AdminOpsController } from './ops/admin-ops.controller';
import { AdminOpsService } from './ops/admin-ops.service';
import { OpsRequestEntity } from './entities/ops-request.entity';
import { PlatformSettingEntity } from './entities/platform-setting.entity';
import { PlatformStaffEntity } from './entities/platform-staff.entity';
import { AnnouncementEntity } from './entities/announcement.entity';
import { IpRuleEntity } from './entities/ip-rule.entity';
import { SecurityIncidentEntity } from './entities/security-incident.entity';
import { PlatformStaffGuard } from './platform-staff.guard';
import { PlatformStaffService } from './platform-staff.service';
import { SettingsService } from './settings/settings.service';
import { TotpService } from './totp.service';
import { AdminAiController } from './ai/admin-ai.controller';
import { AdminAiService } from './ai/admin-ai.service';
import { AdminIntegrationsController } from './integrations/admin-integrations.controller';
import { AdminIntegrationsService } from './integrations/admin-integrations.service';
import { AdminContentController } from './content/admin-content.controller';
import { AdminContentService } from './content/admin-content.service';
import { AdminSecurityController } from './security/admin-security.controller';
import { AdminSecurityService } from './security/admin-security.service';

/**
 * Admin / operations console backend (assembly.loopital.com). Self-contained:
 * staff identity + 2FA auth + RBAC + audit (Phase 1), customers/support
 * (Phase 2), runtime config + billing (Phase 3), monitoring (Phase 4), and
 * approval-gated engineering ops (Phase 5). Reads cross-tenant data via repos
 * registered here; DataSource (for migrations) and SecretEncryption (global
 * CryptoModule) are injected directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformStaffEntity,
      PlatformSettingEntity,
      OpsRequestEntity,
      AuditLogEntity,
      OrganizationEntity,
      UserEntity,
      MembershipEntity,
      SubscriptionEntity,
      PlanEntity,
      UsageCounterEntity,
      PaymentTransactionEntity,
      BackgroundJobEntity,
      AiRequestLogEntity,
      IntegrationConnectionEntity,
      WebhookEventEntity,
      AnnouncementEntity,
      IpRuleEntity,
      SecurityIncidentEntity,
    ]),
    JwtModule.register({}),
    AuditModule,
  ],
  controllers: [
    AdminAuthController,
    AdminStaffController,
    AdminAuditController,
    AdminCustomersController,
    AdminConfigController,
    AdminBillingController,
    AdminMonitoringController,
    AdminOpsController,
    AdminAnalyticsController,
    AdminSystemController,
    AdminDatabaseController,
    AdminAiController,
    AdminIntegrationsController,
    AdminContentController,
    AdminSecurityController,
  ],
  providers: [
    PlatformStaffService,
    AdminAuthService,
    AdminAuditService,
    AdminCustomersService,
    SettingsService,
    AdminBillingService,
    AdminMonitoringService,
    AdminOpsService,
    AdminAnalyticsService,
    AdminDatabaseService,
    AdminAiService,
    AdminIntegrationsService,
    AdminContentService,
    AdminSecurityService,
    TotpService,
    PlatformStaffGuard,
  ],
  exports: [PlatformStaffService, SettingsService],
})
export class AdminModule {}
