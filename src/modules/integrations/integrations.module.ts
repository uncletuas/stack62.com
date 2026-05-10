import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityModule } from '../../shared/security/security.module';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationConnectionEntity } from './entities/integration-connection.entity';
import { IntegrationTokenEntity } from './entities/integration-token.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ProviderRuntimeService } from './provider-runtime.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationConnectionEntity,
      IntegrationTokenEntity,
      WebhookEventEntity,
    ]),
    ActivityModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, ProviderRuntimeService],
  exports: [IntegrationsService, ProviderRuntimeService],
})
export class IntegrationsModule {}
