import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { IntegrationsService } from './integrations.service';
import { WhatsAppConversationService } from './whatsapp-conversation.service';
import { WhatsAppWebService } from './whatsapp-web.service';

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
  attachmentFileIds?: string[];
}

interface SendMessageInput {
  to: string;
  message: string;
  /** Reply to an existing stored message (quoted), web channel only. */
  replyToMessageId?: string;
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

/** Map a file's MIME/extension to a WhatsApp media kind. */
function mediaTypeForMime(
  mime: string,
  filename: string,
): 'image' | 'video' | 'audio' | 'document' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  // Fall back to extension when the MIME is generic (octet-stream).
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (/^(png|jpe?g|gif|webp|bmp|heic)$/.test(ext)) return 'image';
  if (/^(mp4|mov|webm|mkv|avi|m4v)$/.test(ext)) return 'video';
  if (/^(mp3|ogg|opus|wav|m4a|aac)$/.test(ext)) return 'audio';
  return 'document';
}

@Injectable()
export class ProviderRuntimeService {
  private readonly logger = new Logger(ProviderRuntimeService.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
    private readonly whatsAppWeb: WhatsAppWebService,
    private readonly files: FilesService,
    private readonly conversations: WhatsAppConversationService,
  ) {}

  /**
   * Send a media attachment over WhatsApp from a stored file. Routes through a
   * linked device (phone-number pairing), which is the surface the in-app
   * WhatsApp thread uses. Records the outbound message into the conversation
   * thread so it appears immediately. Cloud-API media upload isn't wired yet —
   * we fail clearly rather than silently dropping the attachment.
   */
  async sendWhatsAppMedia(
    ctx: DispatchContext & { actorUserId: string },
    input: {
      to: string;
      fileId: string;
      caption?: string;
      ptt?: boolean;
      forceType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
      replyToMessageId?: string;
    },
  ) {
    const webConn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'whatsapp-web',
      ctx.workspaceId,
    );
    if (!webConn || !(await this.whatsAppWeb.isReady(webConn.id))) {
      throw new BadRequestException(
        'Sending media on WhatsApp needs a linked device. Pair a phone number in Settings ▸ WhatsApp first.',
      );
    }
    const { file, buffer } = await this.files.read(
      input.fileId,
      ctx.actorUserId,
    );
    const mediaType =
      input.forceType ?? mediaTypeForMime(file.mimeType, file.filename);
    const quoted = await this.resolveQuoted(input.replyToMessageId);
    const sent = await this.whatsAppWeb.sendMedia(
      webConn,
      input.to,
      {
        buffer,
        mime: file.mimeType,
        filename: file.filename,
        mediaType,
        ptt: input.ptt,
      },
      input.caption,
      ctx,
      quoted ? { quoted: quoted.stub } : {},
    );
    await this.conversations.recordOutbound({
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId ?? null,
      connectionId: webConn.id,
      channel: 'web',
      contactPhone: input.to,
      text: input.caption ?? '',
      waMessageId: sent.id,
      authoredBy: ctx.source === 'engine' ? 'coworker' : 'user',
      status: 'sent',
      media: {
        mediaType,
        mediaFileId: file.id,
        mediaMimeType: file.mimeType,
        mediaFilename: file.filename,
      },
      replyToMessageId: quoted?.messageId ?? null,
      replyToPreview: quoted?.preview ?? null,
    });
    return sent;
  }

  /** Resolve a stored message id into a Baileys quoted stub + preview. */
  private async resolveQuoted(messageId?: string) {
    if (!messageId) return null;
    try {
      const message = await this.conversations.getMessageById(messageId);
      const conversation = await this.conversations.getConversationById(
        message.conversationId,
      );
      const preview =
        message.text ||
        (message.mediaType ? `[${message.mediaType}]` : '') ||
        ' ';
      const stub = this.whatsAppWeb.buildQuoted({
        contactJid: conversation.contactJid,
        contactPhone: conversation.contactPhone,
        waMessageId: message.waMessageId,
        fromMe: message.direction === 'outbound',
        preview,
      });
      if (!stub) return null;
      return { stub, messageId: message.id, preview };
    } catch {
      return null;
    }
  }

  async sendEmail(ctx: DispatchContext, input: SendEmailInput) {
    // Sends from the org's own connected mailbox (Gmail OAuth, SMTP, or
    // Resend). Resolution + logging live in IntegrationsService so the
    // Compose UI and the Coworker share one code path. No shared-key fallback.
    return this.integrations.sendOrgEmail(
      {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.actorUserId,
      },
      {
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachmentFileIds: input.attachmentFileIds,
      },
    );
  }

  async sendWhatsApp(ctx: DispatchContext, input: SendMessageInput) {
    // Prefer a linked "device" (WhatsApp Web) connection when one is ready —
    // that's the personal/business account a coworker paired by phone number.
    const webConn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'whatsapp-web',
      ctx.workspaceId,
    );
    if (webConn && (await this.whatsAppWeb.isReady(webConn.id))) {
      const quoted = await this.resolveQuoted(input.replyToMessageId);
      const sent = await this.whatsAppWeb.sendText(
        webConn,
        input.to,
        input.message,
        ctx,
        quoted ? { quoted: quoted.stub } : {},
      );
      // For replies we record at send time so the reply context persists
      // (the fromMe echo would otherwise overwrite with no reply info; it
      // dedupes on waMessageId, so this stays a single row). Plain messages
      // keep relying on the echo to avoid changing existing behaviour.
      if (quoted) {
        await this.conversations.recordOutbound({
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId ?? null,
          connectionId: webConn.id,
          channel: 'web',
          contactPhone: input.to,
          text: input.message,
          waMessageId: sent.id,
          authoredBy: ctx.source === 'engine' ? 'coworker' : 'user',
          status: 'sent',
          replyToMessageId: quoted.messageId,
          replyToPreview: quoted.preview,
        });
      }
      return sent;
    }

    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'whatsapp-cloud',
      ctx.workspaceId,
    );
    if (!conn) {
      throw new NotFoundException(
        'No WhatsApp connection. Link a device (phone-number pairing) or add WhatsApp Cloud in the Marketplace.',
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
    await this.log(
      ctx,
      'integration.whatsapp.send',
      conn.id,
      conn.providerKey,
      {
        to: this.maskPhone(input.to),
      },
    );
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
      throw new BadRequestException(
        data.message ?? `Twilio failed (${response.status})`,
      );
    }
    await this.log(ctx, 'integration.sms.send', conn.id, conn.providerKey, {
      to: this.maskPhone(input.to),
    });
    return { provider: 'sms-twilio', id: data.sid ?? null, ok: true };
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
    await this.log(
      ctx,
      'integration.discord.post',
      conn.id,
      conn.providerKey,
      {},
    );
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
      throw new BadRequestException(
        `Telegram: ${result.description ?? 'unknown error'}`,
      );
    }
    await this.log(
      ctx,
      'integration.telegram.send',
      conn.id,
      conn.providerKey,
      {},
    );
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
    const method = (
      input.method ??
      (conn?.config?.method as string) ??
      'POST'
    ).toUpperCase();
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
      await this.log(
        ctx,
        'integration.http.request',
        conn.id,
        conn.providerKey,
        {
          method,
          status: response.status,
        },
      );
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
        | undefined) ?? this.configService.get<string>('PAYSTACK_SECRET_KEY');
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
      await this.log(
        ctx,
        'integration.payment.initialize',
        conn.id,
        conn.providerKey,
        {
          amountKobo: input.amountKobo,
        },
      );
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

  async paystackVerify(ctx: DispatchContext, input: { reference: string }) {
    const conn = await this.integrations.resolveConnection(
      ctx.organizationId,
      'paystack',
      ctx.workspaceId,
    );
    const secretKey =
      (conn
        ? (this.integrations.decryptCredentials(conn)?.secretKey as
            | string
            | undefined)
        : undefined) ?? this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      throw new BadRequestException('Paystack is not configured.');
    }
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        input.reference,
      )}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    const data = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        amount?: number;
        reference?: string;
        customer?: { email?: string };
      };
    };
    if (!response.ok) {
      throw new BadRequestException(
        data.message ?? `Paystack verify failed (${response.status})`,
      );
    }
    if (conn) {
      await this.log(
        ctx,
        'integration.payment.verify',
        conn.id,
        conn.providerKey,
        {
          reference: input.reference,
          paymentStatus: data.data?.status ?? null,
        },
      );
    }
    return {
      provider: 'paystack',
      ok: Boolean(data.status),
      paymentStatus: data.data?.status ?? null,
      amountKobo: data.data?.amount ?? null,
      reference: data.data?.reference ?? input.reference,
      customerEmail: data.data?.customer?.email ?? null,
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
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
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
    const kDate = createHmac('sha256', `AWS4${secretAccessKey}`)
      .update(dateStamp)
      .digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService)
      .update('aws4_request')
      .digest();
    const signature = createHmac('sha256', kSigning)
      .update(stringToSign)
      .digest('hex');
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
    // WhatsApp Web stores its session separately (no connection credentials);
    // "verify" means: is the paired device live?
    if (conn.providerKey === 'whatsapp-web') {
      const ready = await this.whatsAppWeb.isReady(conn.id);
      conn.lastCheckedAt = new Date();
      await this.integrations.touchConnection(conn);
      return ready
        ? { ok: true, message: 'WhatsApp device is linked and online.' }
        : {
            ok: false,
            message:
              'WhatsApp device is not linked yet. Start the link flow and enter the pairing code.',
          };
    }
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
            : {
                ok: false,
                message: `Resend rejected the key (${res.status}).`,
              };
        }
        case 'telegram': {
          const res = await fetch(
            `https://api.telegram.org/bot${creds.botToken}/getMe`,
          );
          const data = (await res.json()) as {
            ok?: boolean;
            description?: string;
          };
          return data.ok
            ? { ok: true, message: 'Telegram bot reachable.' }
            : {
                ok: false,
                message: `Telegram: ${data.description ?? 'failed'}`,
              };
        }
        case 'hubspot': {
          const res = await fetch(
            'https://api.hubapi.com/account-info/v3/details',
            { headers: { Authorization: `Bearer ${creds.accessToken}` } },
          );
          return res.ok
            ? { ok: true, message: 'HubSpot token accepted.' }
            : {
                ok: false,
                message: `HubSpot rejected the token (${res.status}).`,
              };
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
            : {
                ok: false,
                message: `Notion rejected the token (${res.status}).`,
              };
        }
        case 'airtable': {
          const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
            headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
          });
          return res.ok
            ? { ok: true, message: 'Airtable token accepted.' }
            : {
                ok: false,
                message: `Airtable rejected the token (${res.status}).`,
              };
        }
        case 'calendly': {
          const res = await fetch('https://api.calendly.com/users/me', {
            headers: { Authorization: `Bearer ${creds.personalAccessToken}` },
          });
          return res.ok
            ? { ok: true, message: 'Calendly token accepted.' }
            : {
                ok: false,
                message: `Calendly rejected the token (${res.status}).`,
              };
        }
        case 'mailchimp': {
          const prefix = creds.serverPrefix as string | undefined;
          if (!prefix)
            return {
              ok: false,
              message: 'Missing serverPrefix (e.g. "us21").',
            };
          const res = await fetch(
            `https://${prefix}.api.mailchimp.com/3.0/ping`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`anystring:${creds.apiKey}`).toString('base64')}`,
              },
            },
          );
          return res.ok
            ? { ok: true, message: 'Mailchimp key accepted.' }
            : {
                ok: false,
                message: `Mailchimp rejected the key (${res.status}).`,
              };
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
    const cfg = conn.config ?? {};
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
