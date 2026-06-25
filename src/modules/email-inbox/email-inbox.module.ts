import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailPollingService } from './email-polling.service';

/**
 * Hosts the incoming-email poller. Imported by the API process so the
 * EMAIL_INBOUND_EVENT it emits is delivered in-process to the engine's
 * EmailResponderService.
 */
@Module({
  imports: [IntegrationsModule],
  providers: [EmailPollingService],
})
export class EmailInboxModule {}
