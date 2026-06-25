import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityModule } from '../../shared/security/security.module';
import { ActivityModule } from '../activity/activity.module';
import { AuditModule } from '../audit/audit.module';
import { FileSharingModule } from '../file-sharing/file-sharing.module';
import { FilesModule } from '../files/files.module';
import { EmailConversationEntity } from './entities/email-conversation.entity';
import { EmailMessageEntity } from './entities/email-message.entity';
import { IntegrationConnectionEntity } from './entities/integration-connection.entity';
import { IntegrationTokenEntity } from './entities/integration-token.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import { WhatsAppConversationEntity } from './entities/whatsapp-conversation.entity';
import { WhatsAppMessageEntity } from './entities/whatsapp-message.entity';
import { WhatsAppWebSessionEntity } from './entities/whatsapp-web-session.entity';
import { EmailConversationService } from './email-conversation.service';
import { EmailReaderService } from './email-reader.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ProviderRuntimeService } from './provider-runtime.service';
import { WhatsAppConversationService } from './whatsapp-conversation.service';
import { WhatsAppWebService } from './whatsapp-web.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationConnectionEntity,
      IntegrationTokenEntity,
      WebhookEventEntity,
      WhatsAppWebSessionEntity,
      WhatsAppConversationEntity,
      WhatsAppMessageEntity,
      EmailConversationEntity,
      EmailMessageEntity,
    ]),
    ActivityModule,
    AuditModule,
    SecurityModule,
    FileSharingModule, // for EmailSenderService (SMTP/Resend transport)
    FilesModule, // for storing inbound/outbound WhatsApp media as files
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    ProviderRuntimeService,
    WhatsAppWebService,
    WhatsAppConversationService,
    EmailConversationService,
    EmailReaderService,
  ],
  exports: [
    IntegrationsService,
    ProviderRuntimeService,
    WhatsAppWebService,
    WhatsAppConversationService,
    EmailConversationService,
    EmailReaderService,
  ],
})
export class IntegrationsModule {}
