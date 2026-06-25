import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Single email sender for the whole app. Supports two transports:
 *
 *   1. SMTP (Gmail, business mailbox, any SMTP server) — preferred when
 *      configured. Lets you send from a normal account without verifying
 *      a domain on a transactional provider.
 *        Required: SMTP_HOST, SMTP_USER, SMTP_PASSWORD
 *        Optional: SMTP_PORT (default 587), SMTP_SECURE, SMTP_FROM_EMAIL
 *
 *   2. Resend REST API — fallback when SMTP isn't configured.
 *        Required: RESEND_API_KEY, RESEND_FROM_EMAIL
 *
 * When neither is configured the call returns `{ ok: false }` and we log a
 * warning, so flows that depend on email degrade gracefully instead of
 * crashing the whole request.
 */
export interface SendEmailResult {
  ok: boolean;
  provider: 'smtp' | 'resend' | null;
  id: string | null;
  error?: string;
}

/** A file attached to an outgoing email. */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** True when SMTP credentials are present. */
  private smtpConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('SMTP_HOST') &&
      this.configService.get<string>('SMTP_USER') &&
      this.configService.get<string>('SMTP_PASSWORD'),
    );
  }

  /** True when Resend credentials are present. */
  private resendConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('RESEND_API_KEY') &&
      this.configService.get<string>('RESEND_FROM_EMAIL'),
    );
  }

  /** Any transport available? */
  isConfigured(): boolean {
    return this.smtpConfigured() || this.resendConfigured();
  }

  /** Which transport would be used, for diagnostics / UI hints. */
  activeProvider(): 'smtp' | 'resend' | null {
    if (this.smtpConfigured()) return 'smtp';
    if (this.resendConfigured()) return 'resend';
    return null;
  }

  /**
   * Send an email. Prefers SMTP, falls back to Resend. Returns a rich
   * result; callers that only care about success can read `.ok`.
   */
  async send(payload: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<SendEmailResult> {
    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];

    if (this.smtpConfigured()) {
      return this.sendViaSmtp({ ...payload, to: recipients });
    }
    if (this.resendConfigured()) {
      return this.sendViaResend({ ...payload, to: recipients });
    }

    this.logger.warn(
      `Email skipped (no transport configured): to=${recipients.join(
        ',',
      )} subject="${payload.subject}"`,
    );
    return { ok: false, provider: null, id: null, error: 'not_configured' };
  }

  /**
   * Backward-compatible boolean send used by existing callers
   * (share invites, auth verify/reset, coworker email tool).
   */
  async sendEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<boolean> {
    const result = await this.send(payload);
    return result.ok;
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const host = this.configService.get<string>('SMTP_HOST')!;
    const port = this.configService.get<number>('SMTP_PORT') ?? 587;
    const user = this.configService.get<string>('SMTP_USER')!;
    const pass = this.configService.get<string>('SMTP_PASSWORD')!;
    // SMTP_SECURE: explicit override; otherwise infer from the port
    // (465 = implicit TLS, everything else = STARTTLS).
    const secure =
      this.configService.get<boolean>('SMTP_SECURE') ?? port === 465;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    return this.transporter;
  }

  private smtpFrom(): string {
    return (
      this.configService.get<string>('SMTP_FROM_EMAIL') ??
      this.configService.get<string>('RESEND_FROM_EMAIL') ??
      this.configService.get<string>('SMTP_USER')!
    );
  }

  /**
   * Send through an arbitrary SMTP server using credentials supplied by the
   * caller (a per-org `smtp-email` integration connection) rather than env.
   * A fresh transport is created per send — these are infrequent and we don't
   * want to cache one transport per connection.
   */
  async sendSmtp(
    config: {
      host: string;
      port?: number;
      username: string;
      password: string;
      secure?: boolean;
      fromEmail?: string;
      fromName?: string;
    },
    payload: {
      to: string[];
      subject: string;
      html: string;
      text?: string;
      replyTo?: string;
      attachments?: EmailAttachment[];
    },
  ): Promise<SendEmailResult> {
    const port = config.port ?? 587;
    const fromAddress = config.fromEmail ?? config.username;
    const from = config.fromName
      ? `"${config.fromName.replace(/"/g, '')}" <${fromAddress}>`
      : fromAddress;
    try {
      const transport = nodemailer.createTransport({
        host: config.host,
        port,
        secure: config.secure ?? port === 465,
        auth: { user: config.username, pass: config.password },
      });
      const info = await transport.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
        attachments: payload.attachments,
      });
      return { ok: true, provider: 'smtp', id: info.messageId ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP (connection) send failed: ${message}`);
      return { ok: false, provider: 'smtp', id: null, error: message };
    }
  }

  private async sendViaSmtp(payload: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<SendEmailResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: this.smtpFrom(),
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo,
      });
      return { ok: true, provider: 'smtp', id: info.messageId ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP send failed: ${message}`);
      return { ok: false, provider: 'smtp', id: null, error: message };
    }
  }

  private async sendViaResend(payload: {
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<SendEmailResult> {
    const apiKey = this.configService.get<string>('RESEND_API_KEY')!;
    const from = this.configService.get<string>('RESEND_FROM_EMAIL')!;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          reply_to: payload.replyTo,
        }),
      });
      const bodyText = await response.text().catch(() => '');
      if (!response.ok) {
        this.logger.error(
          `Resend send failed (${response.status}): ${bodyText.slice(0, 240)}`,
        );
        return {
          ok: false,
          provider: 'resend',
          id: null,
          error: bodyText.slice(0, 240) || `status ${response.status}`,
        };
      }
      let id: string | null = null;
      try {
        const parsed = bodyText
          ? (JSON.parse(bodyText) as { id?: string })
          : {};
        id = parsed.id ?? null;
      } catch {
        // non-JSON success body; ignore
      }
      return { ok: true, provider: 'resend', id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Resend send threw: ${message}`);
      return { ok: false, provider: 'resend', id: null, error: message };
    }
  }
}
