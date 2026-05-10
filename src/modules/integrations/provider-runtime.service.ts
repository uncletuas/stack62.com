import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from './integrations.service';

interface DispatchContext {
  organizationId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  source?: string;
}

interface SendEmailInput {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

interface SendMessageInput {
  to: string;
  message: string;
}

interface SlackPostInput {
  channel?: string;
  text: string;
}

interface DiscordPostInput {
  text: string;
}

interface SmsInput {
  to: string;
  body: string;
}

interface HttpRequestInput {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

interface S3PutInput {
  key: string;
  body: string;
  contentType?: string;
}

interface PaystackInitInput {
  email: string;
  amountKobo: number;
  reference?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ProviderRuntimeService {
  private readonly logger = new Logger(ProviderRuntimeService.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async sendEmail(ctx: DispatchContext, input: SendEmailInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'resend',
      ctx.workspaceId,
    );
    if (conn) {
      const creds = this.integrations.decryptCredentials(conn);
      const apiKey = creds?.apiKey as string | undefined;
      const from = (conn.config?.fromEmail as string | undefined) ??
        this.configService.get<string>('RESEND_FROM_EMAIL');
      if (!apiKey || !from) {
        throw new BadRequestException(
          'Resend connection is missing apiKey or fromEmail.',
        );
      }
      const result = await this.postJson<{ id?: string }>(
        'https://api.resend.com/emails',
        { from, to: input.to, subject: input.subject, text: input.text, html: input.html },
        { Authorization: `Bearer ${apiKey}` },
      );
      await this.log(ctx, 'integration.email.send', conn.id, conn.providerKey, {
        toCount: input.to.length,
        subject: input.subject,
      });
      return { provider: 'resend', id: result.id ?? null, ok: true };
    }

    const smtp = await this.integrations.resolveConnection(
      ctx.organizationId,
      'smtp-email',
      ctx.workspaceId,
    );
    if (smtp) {
      // Without a Node SMTP client dependency, surface a clear error.
      throw new BadRequestException(
        'SMTP transport is configured but the runtime SMTP client is not bundled. Use Resend or another email provider until SMTP is enabled.',
      );
    }

    throw new NotFoundException(
      'No active email connection. Connect Resend in the Marketplace.',
    );
  }

  async sendWhatsApp(ctx: DispatchContext, input: SendMessageInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'whatsapp-cloud',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No WhatsApp Cloud connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const accessToken = creds?.accessToken as string | undefined;
    const phoneNumberId =
      (creds?.phoneNumberId as string | undefined) ??
      (conn.config?.phoneNumberId as string | undefined) ??
      (conn.config?.selectedPhoneNumberId as string | undefined);
    if (!accessToken || !phoneNumberId) {
      throw new BadRequestException(
        'WhatsApp is connected, but no business phone number has been selected yet.',
      );
    }
    const result = await this.postJson<{
      messages?: Array<{ id?: string }>;
    }>(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: input.to,
        type: 'text',
        text: { preview_url: false, body: input.message },
      },
      { Authorization: `Bearer ${accessToken}` },
    );
    await this.log(ctx, 'integration.whatsapp.send', conn.id, conn.providerKey, {
      to: this.maskPhone(input.to),
    });
    return {
      provider: 'whatsapp-cloud',
      id: result.messages?.[0]?.id ?? null,
      ok: true,
    };
  }

  async sendSms(ctx: DispatchContext, input: SmsInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'sms-twilio',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No Twilio SMS connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const sid = creds?.accountSid as string | undefined;
    const token = creds?.authToken as string | undefined;
    const from = conn.config?.fromNumber as string | undefined;
    if (!sid || !token || !from) {
      throw new BadRequestException(
        'Twilio connection is missing accountSid, authToken, or fromNumber.',
      );
    }
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const body = new URLSearchParams({
      From: from,
      To: input.to,
      Body: input.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );
    const data = (await response.json()) as { sid?: string; message?: string };
    if (!response.ok) {
      throw new BadRequestException(data.message ?? `Twilio failed (${response.status})`);
    }
    await this.log(ctx, 'integration.sms.send', conn.id, conn.providerKey, {
      to: this.maskPhone(input.to),
    });
    return { provider: 'sms-twilio', id: data.sid ?? null, ok: true };
  }

  async postSlack(ctx: DispatchContext, input: SlackPostInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'slack',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No Slack connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const botToken = creds?.botToken as string | undefined;
    const channel =
      input.channel ?? (conn.config?.defaultChannel as string | undefined);
    if (!botToken || !channel) {
      throw new BadRequestException(
        'Slack connection is missing botToken or default channel.',
      );
    }
    const result = await this.postJson<{ ok: boolean; ts?: string; error?: string }>(
      'https://slack.com/api/chat.postMessage',
      { channel, text: input.text },
      { Authorization: `Bearer ${botToken}` },
    );
    if (!result.ok) {
      throw new BadRequestException(`Slack: ${result.error ?? 'unknown error'}`);
    }
    await this.log(ctx, 'integration.slack.post', conn.id, conn.providerKey, {
      channel,
    });
    return { provider: 'slack', id: result.ts ?? null, ok: true };
  }

  async postDiscord(ctx: DispatchContext, input: DiscordPostInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'discord',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No Discord connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const url = creds?.webhookUrl as string | undefined;
    if (!url) {
      throw new BadRequestException(
        'Discord connection is missing webhookUrl.',
      );
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: input.text }),
    });
    if (!response.ok) {
      throw new BadRequestException(
        `Discord webhook failed (${response.status})`,
      );
    }
    await this.log(ctx, 'integration.discord.post', conn.id, conn.providerKey, {});
    return { provider: 'discord', ok: true };
  }

  async sendTelegram(ctx: DispatchContext, input: SendMessageInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'telegram',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No Telegram connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const botToken = creds?.botToken as string | undefined;
    const chatId =
      input.to ?? (conn.config?.defaultChatId as string | undefined);
    if (!botToken || !chatId) {
      throw new BadRequestException(
        'Telegram connection is missing botToken or chatId.',
      );
    }
    const result = await this.postJson<{
      ok: boolean;
      result?: { message_id?: number };
      description?: string;
    }>(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: input.message },
      {},
    );
    if (!result.ok) {
      throw new BadRequestException(`Telegram: ${result.description ?? 'unknown error'}`);
    }
    await this.log(ctx, 'integration.telegram.send', conn.id, conn.providerKey, {});
    return {
      provider: 'telegram',
      id: result.result?.message_id ?? null,
      ok: true,
    };
  }

  async httpRequest(ctx: DispatchContext, input: HttpRequestInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'webhook',
      ctx.workspaceId,
    );
    const baseUrl = (conn?.config?.url as string | undefined) ?? input.url;
    if (!baseUrl) {
      throw new BadRequestException('No webhook URL configured.');
    }
    const method = (input.method ?? (conn?.config?.method as string) ?? 'POST').toUpperCase();
    const headers: Record<string, string> = { ...(input.headers ?? {}) };
    if (conn) {
      const creds = this.integrations.decryptCredentials(conn);
      const headerName = creds?.secretHeaderName as string | undefined;
      const headerValue = creds?.secretHeaderValue as string | undefined;
      if (headerName && headerValue) headers[headerName] = headerValue;
    }
    if (!headers['Content-Type'] && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    const url = new URL(baseUrl);
    if (input.query) {
      for (const [k, v] of Object.entries(input.query)) {
        url.searchParams.set(k, v);
      }
    }
    const response = await fetch(url.toString(), {
      method,
      headers,
      body:
        method === 'GET'
          ? undefined
          : typeof input.body === 'string'
          ? input.body
          : JSON.stringify(input.body ?? {}),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* leave as text */
    }
    if (conn) {
      await this.log(ctx, 'integration.http.request', conn.id, conn.providerKey, {
        method,
        status: response.status,
      });
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parsed,
    };
  }

  async paystackInitialize(ctx: DispatchContext, input: PaystackInitInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'paystack',
      ctx.workspaceId,
    );
    const secretKey =
      (this.integrations.decryptCredentials(conn!)?.secretKey as
        | string
        | undefined) ??
      this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new BadRequestException('Paystack is not configured.');
    }
    const callbackUrl =
      input.callbackUrl ??
      (conn?.config?.callbackUrl as string | undefined) ??
      this.configService.get<string>('PAYSTACK_CALLBACK_URL');
    const result = await this.postJson<{
      status: boolean;
      message: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    }>(
      'https://api.paystack.co/transaction/initialize',
      {
        email: input.email,
        amount: input.amountKobo,
        reference: input.reference,
        callback_url: callbackUrl,
        metadata: input.metadata ?? {},
      },
      { Authorization: `Bearer ${secretKey}` },
    );
    if (conn) {
      await this.log(ctx, 'integration.payment.initialize', conn.id, conn.providerKey, {
        amountKobo: input.amountKobo,
      });
    }
    return {
      provider: 'paystack',
      ok: result.status,
      message: result.message,
      authorizationUrl: result.data?.authorization_url ?? null,
      accessCode: result.data?.access_code ?? null,
      reference: result.data?.reference ?? null,
    };
  }

  async s3Put(ctx: DispatchContext, input: S3PutInput) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'aws-s3',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No S3 connection. Add one in the Marketplace.',
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    const bucket = conn.config?.bucket as string | undefined;
    const region = (conn.config?.region as string | undefined) ?? 'us-east-1';
    if (!creds?.accessKeyId || !creds?.secretAccessKey || !bucket) {
      throw new BadRequestException(
        'S3 connection is missing access keys or bucket.',
      );
    }
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(
      input.key,
    )}`;
    const response = await this.signedS3Put(
      url,
      input.body,
      input.contentType ?? 'application/octet-stream',
      creds.accessKeyId as string,
      creds.secretAccessKey as string,
      region,
      bucket,
      input.key,
    );
    if (!response.ok) {
      throw new BadRequestException(
        `S3 PUT failed: ${response.status} ${response.statusText}`,
      );
    }
    await this.log(ctx, 'integration.s3.put', conn.id, conn.providerKey, {
      bucket,
      key: input.key,
    });
    return { provider: 'aws-s3', ok: true, url };
  }

  private async signedS3Put(
    url: string,
    body: string,
    contentType: string,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    bucket: string,
    key: string,
  ) {
    const { createHash, createHmac } = await import('node:crypto');
    const amzDate = new Date()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const canonicalRequest = [
      'PUT',
      `/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
      '',
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
      '',
      'content-type;host;x-amz-content-sha256;x-amz-date',
      payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ` +
      `Signature=${signature}`;
    return fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
      body,
    });
  }

  private async postJson<T>(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : null) ?? `${url} failed with status ${response.status}`;
      throw new BadRequestException(message);
    }
    return data as T;
  }

  private maskPhone(phone: string) {
    if (phone.length < 4) return '***';
    return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
  }

  /** Verifies that a saved connection's credentials work. */
  async verifyConnection(
    connectionId: string,
    actorUserId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const conn = await this.integrations.findConnectionRaw(
      connectionId,
      actorUserId,
    );
    const creds = this.integrations.decryptCredentials(conn);
    if (!creds) {
      return { ok: false, message: 'No credentials stored.' };
    }
    try {
      switch (conn.providerKey) {
        case 'resend': {
          const res = await fetch('https://api.resend.com/api-keys', {
            headers: { Authorization: `Bearer ${creds.apiKey}` },
          });
          return res.ok
            ? { ok: true, message: 'Resend key accepted.' }
            : { ok: false, message: `Resend rejected the key (${res.status}).` };
        }
        case 'slack': {
          const res = await fetch('https://slack.com/api/auth.test', {
            headers: { Authorization: `Bearer ${creds.botToken}` },
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          return data.ok
            ? { ok: true, message: 'Slack token accepted.' }
            : { ok: false, message: `Slack: ${data.error ?? 'auth failed'}` };
        }
        case 'telegram': {
          const res = await fetch(
            `https://api.telegram.org/bot${creds.botToken}/getMe`,
          );
          const data = (await res.json()) as { ok?: boolean; description?: string };
          return data.ok
            ? { ok: true, message: 'Telegram bot reachable.' }
            : { ok: false, message: `Telegram: ${data.description ?? 'failed'}` };
        }
        case 'hubspot': {
          const res = await fetch(
            'https://api.hubapi.com/account-info/v3/details',
            { headers: { Authorization: `Bearer ${creds.accessToken}` } },
          );
          return res.ok
            ? { ok: true, message: 'HubSpot token accepted.' }
            : { ok: false, message: `HubSpot rejected the token (${res.status}).` };
        }
        case 'notion': {
          const res = await fetch('https://api.notion.com/v1/users/me', {
            headers: {
              Authorization: `Bearer ${creds.integrationToken}`,
              'Notion-Version': '2022-06-28',
            },
          });
          return res.ok
            ? { ok: true, message: 'Notion token accepted.' }
            : { ok: false, message: `Notion rejected the token (${res.status}).` };
        }
        case 'airtable': {
          const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
            headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
          });
          return res.ok
            ? { ok: true, message: 'Airtable token accepted.' }
            : { ok: false, message: `Airtable rejected the token (${res.status}).` };
        }
        case 'calendly': {
          const res = await fetch('https://api.calendly.com/users/me', {
            headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
          });
          return res.ok
            ? { ok: true, message: 'Calendly token accepted.' }
            : { ok: false, message: `Calendly rejected the token (${res.status}).` };
        }
        case 'mailchimp': {
          const prefix = creds.serverPrefix as string | undefined;
          if (!prefix)
            return { ok: false, message: 'Missing serverPrefix (e.g. "us21").' };
          const res = await fetch(`https://${prefix}.api.mailchimp.com/3.0/ping`, {
            headers: {
              Authorization: `Basic ${Buffer.from(`anystring:${creds.apiKey}`).toString('base64')}`,
            },
          });
          return res.ok
            ? { ok: true, message: 'Mailchimp key accepted.' }
            : { ok: false, message: `Mailchimp rejected the key (${res.status}).` };
        }
        case 'webhook':
        case 'discord':
        case 'zoom':
        case 'google-meet':
        case 'sms-twilio':
        case 'aws-s3':
        case 'salesforce':
        case 'whatsapp-cloud':
        case 'paystack':
        case 'stripe':
        case 'quickbooks':
        case 'smtp-email': {
          // No cheap verify endpoint — accept on save.
          return { ok: true, message: 'Stored. Will be tested on first use.' };
        }
        default:
          return { ok: true, message: 'Stored. Will be tested on first use.' };
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Verification failed.',
      };
    } finally {
      conn.lastCheckedAt = new Date();
      await this.integrations.touchConnection(conn);
    }
  }

  /**
   * Generic authenticated HTTP call against a connected provider, used by the
   * AI engine for providers that don't have a dedicated runtime path.
   */
  async apiCall(
    ctx: DispatchContext,
    input: {
      providerKey: string;
      path: string;
      method?: string;
      body?: unknown;
      query?: Record<string, string>;
      headers?: Record<string, string>;
    },
  ) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      input.providerKey,
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        `No active connection for provider "${input.providerKey}".`,
      );
    }
    const creds = this.integrations.decryptCredentials(conn);
    if (!creds) {
      throw new BadRequestException(
        `Connection "${conn.name}" has no credentials.`,
      );
    }
    const cfg = (conn.config ?? {}) as Record<string, unknown>;
    const { url, headers } = this.buildAuthedRequest(
      conn.providerKey,
      input.path,
      creds,
      cfg,
    );
    if (!url) {
      throw new BadRequestException(
        `apiCall is not yet supported for provider "${conn.providerKey}".`,
      );
    }
    const finalUrl = new URL(url);
    if (input.query) {
      for (const [k, v] of Object.entries(input.query)) {
        finalUrl.searchParams.set(k, v);
      }
    }
    const method = (input.method ?? 'GET').toUpperCase();
    const allHeaders: Record<string, string> = {
      ...(input.headers ?? {}),
      ...headers,
    };
    if (method !== 'GET' && !allHeaders['Content-Type']) {
      allHeaders['Content-Type'] = 'application/json';
    }
    const response = await fetch(finalUrl.toString(), {
      method,
      headers: allHeaders,
      body:
        method === 'GET'
          ? undefined
          : typeof input.body === 'string'
          ? input.body
          : JSON.stringify(input.body ?? {}),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* leave as text */
    }
    await this.log(
      ctx,
      `integration.${conn.providerKey}.api_call`,
      conn.id,
      conn.providerKey,
      { method, status: response.status, path: input.path },
    );
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parsed,
    };
  }

  private buildAuthedRequest(
    providerKey: string,
    path: string,
    creds: Record<string, unknown>,
    cfg: Record<string, unknown>,
  ): { url: string | null; headers: Record<string, string> } {
    const join = (base: string) =>
      path.startsWith('http')
        ? path
        : `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
    switch (providerKey) {
      case 'hubspot':
        return {
          url: join('https://api.hubapi.com'),
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        };
      case 'notion':
        return {
          url: join('https://api.notion.com/v1'),
          headers: {
            Authorization: `Bearer ${creds.integrationToken}`,
            'Notion-Version': '2022-06-28',
          },
        };
      case 'airtable':
        return {
          url: join('https://api.airtable.com/v0'),
          headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
        };
      case 'calendly':
        return {
          url: join('https://api.calendly.com'),
          headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
        };
      case 'mailchimp': {
        const prefix = cfg.serverPrefix ?? creds.serverPrefix;
        return {
          url: prefix ? join(`https://${prefix}.api.mailchimp.com/3.0`) : null,
          headers: {
            Authorization: `Basic ${Buffer.from(`anystring:${creds.apiKey}`).toString('base64')}`,
          },
        };
      }
      case 'salesforce':
        return {
          url: creds.instanceUrl
            ? join(`${creds.instanceUrl}/services/data/v59.0`)
            : null,
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        };
      case 'slack':
        return {
          url: join('https://slack.com/api'),
          headers: { Authorization: `Bearer ${creds.botToken}` },
        };
      case 'quickbooks': {
        const realmId =
          (cfg.realmId as string | undefined) ??
          (creds.realmId as string | undefined) ??
          '';
        const env =
          (cfg.environment as string | undefined) === 'production'
            ? 'https://quickbooks.api.intuit.com'
            : 'https://sandbox-quickbooks.api.intuit.com';
        if (!realmId) return { url: null, headers: {} };
        return {
          url: join(`${env}/v3/company/${realmId}`),
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            Accept: 'application/json',
          },
        };
      }
      default:
        return { url: null, headers: {} };
    }
  }

  private async log(
    ctx: DispatchContext,
    action: string,
    connectionId: string,
    providerKey: string,
    metadata: Record<string, unknown>,
  ) {
    const data = {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId ?? null,
      actorUserId: ctx.actorUserId ?? null,
      action,
      targetType: 'integration_dispatch',
      targetId: connectionId,
      origin: ctx.source === 'engine' ? ('ai' as const) : ('system' as const),
    };
    await this.activity.log({
      ...data,
      metadata: { providerKey, ...metadata },
    });
    await this.audit.log({
      ...data,
      afterData: { providerKey, ...metadata },
    });
  }
}
