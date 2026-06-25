import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailConversationService } from '../integrations/email-conversation.service';
import { EmailReaderService } from '../integrations/email-reader.service';
import { IntegrationsService } from '../integrations/integrations.service';

/**
 * Polls each connected mailbox (Gmail / SMTP+IMAP) for new incoming email and
 * records it, which emits EMAIL_INBOUND_EVENT for the responder. Runs in the
 * API process so the in-process event reaches the engine's EmailResponder.
 * setInterval + ticking flag (same pattern as workflow automation); dedupe is
 * by the unique (connectionId, externalId) on the message table.
 */
@Injectable()
export class EmailPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailPollingService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly integrations: IntegrationsService,
    private readonly reader: EmailReaderService,
    private readonly conversations: EmailConversationService,
  ) {}

  onModuleInit() {
    if (!this.configService.get<boolean>('EMAIL_POLLING_ENABLED', true)) {
      this.logger.log('Email polling disabled.');
      return;
    }
    const intervalMs = this.configService.get<number>(
      'EMAIL_POLLING_INTERVAL_MS',
      120000,
    );
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error(
          `Email polling tick failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`Email polling every ${intervalMs}ms.`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const connections = await this.integrations.listActiveEmailConnections();
      for (const connection of connections) {
        if (!this.reader.canRead(connection)) continue;
        try {
          const items = await this.reader.fetchNew(connection);
          for (const item of items) {
            await this.conversations.recordInbound({
              organizationId: connection.organizationId,
              workspaceId: connection.workspaceId,
              connectionId: connection.id,
              providerKey: connection.providerKey,
              counterpartyEmail: item.fromEmail,
              counterpartyName: item.fromName,
              subject: item.subject,
              bodyText: item.bodyText,
              externalId: item.externalId,
              threadId: item.threadId,
              receivedAt: item.receivedAt,
              notifyUserId: connection.createdByUserId ?? null,
            });
          }
        } catch (err) {
          this.logger.warn(
            `Polling connection ${connection.id} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        } finally {
          connection.lastCheckedAt = new Date();
          await this.integrations.touchConnection(connection);
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
