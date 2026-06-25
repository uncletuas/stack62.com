import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { IntegrationsService } from './integrations.service';
import { IntegrationConnectionEntity } from './entities/integration-connection.entity';
import type { NormalizedInboundEmail } from './email-reader.types';

/**
 * Reads new inbound email from a connected mailbox. Gmail (OAuth) goes through
 * the Gmail API via IntegrationsService; SMTP connections that also carry IMAP
 * details are read over IMAP. Used by the polling service.
 */
@Injectable()
export class EmailReaderService {
  private readonly logger = new Logger(EmailReaderService.name);

  constructor(private readonly integrations: IntegrationsService) {}

  /** Can we read incoming mail for this connection? */
  canRead(connection: IntegrationConnectionEntity): boolean {
    if (connection.providerKey === 'google-workspace') return true;
    if (connection.providerKey === 'smtp-email') {
      const creds = this.integrations.decryptCredentials(connection);
      return Boolean(creds?.imapHost);
    }
    return false;
  }

  async fetchNew(
    connection: IntegrationConnectionEntity,
  ): Promise<NormalizedInboundEmail[]> {
    try {
      if (connection.providerKey === 'google-workspace') {
        return await this.integrations.fetchGmailInbox(connection);
      }
      if (connection.providerKey === 'smtp-email') {
        return await this.fetchImap(connection);
      }
    } catch (err) {
      this.logger.warn(
        `Email read failed for connection ${connection.id} (${connection.providerKey}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return [];
  }

  /** Read recent INBOX messages over IMAP for an smtp-email connection. */
  private async fetchImap(
    connection: IntegrationConnectionEntity,
  ): Promise<NormalizedInboundEmail[]> {
    const creds = this.integrations.decryptCredentials(connection);
    const host = creds?.imapHost as string | undefined;
    const username = creds?.username as string | undefined;
    const password = creds?.password as string | undefined;
    if (!host || !username || !password) return [];
    const port = creds?.imapPort ? Number(creds.imapPort) : 993;
    await this.assertSafeImapHost(host, port);

    const client = new ImapFlow({
      host,
      port,
      secure: port === 993,
      auth: { user: username, pass: password },
      logger: false,
    });
    const out: NormalizedInboundEmail[] = [];
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });
        const recent = (Array.isArray(uids) ? uids : []).slice(-25);
        for (const uid of recent) {
          const msg = await client.fetchOne(
            String(uid),
            { source: true, envelope: true },
            { uid: true },
          );
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const fromAddr = parsed.from?.value?.[0];
          out.push({
            externalId: `imap-${uid}`,
            threadId: null,
            fromEmail: fromAddr?.address ?? 'unknown',
            fromName: fromAddr?.name || null,
            subject: parsed.subject ?? null,
            bodyText:
              parsed.text ||
              (typeof parsed.html === 'string'
                ? parsed.html.replace(/<[^>]+>/g, ' ').trim()
                : ''),
            receivedAt: parsed.date ?? null,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }

  /**
   * Guard against SSRF via a user-supplied IMAP host: only standard IMAP ports,
   * and no private/loopback/link-local addresses.
   */
  private async assertSafeImapHost(host: string, port: number): Promise<void> {
    if (port !== 993 && port !== 143) {
      throw new BadRequestException('IMAP port must be 993 (TLS) or 143.');
    }
    let addresses: string[];
    if (isIP(host)) {
      addresses = [host];
    } else {
      const resolved = await dns.lookup(host, { all: true }).catch(() => []);
      addresses = resolved.map((r) => r.address);
    }
    if (addresses.length === 0) {
      throw new BadRequestException(`Cannot resolve IMAP host "${host}".`);
    }
    for (const addr of addresses) {
      if (this.isPrivateAddress(addr)) {
        throw new BadRequestException(
          'IMAP host resolves to a private/internal address, which is not allowed.',
        );
      }
    }
  }

  private isPrivateAddress(addr: string): boolean {
    if (addr === '127.0.0.1' || addr === '::1') return true;
    if (/^10\./.test(addr)) return true;
    if (/^192\.168\./.test(addr)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)) return true;
    if (/^169\.254\./.test(addr)) return true; // link-local
    if (/^127\./.test(addr)) return true;
    if (/^(fc|fd)/i.test(addr)) return true; // IPv6 unique-local
    if (/^fe80:/i.test(addr)) return true; // IPv6 link-local
    return false;
  }
}
