import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around Resend's REST API. Used by FileSharingService
 * (and future invite emails). No SDK — raw fetch keeps the dep
 * surface clean and Resend's HTTP API is straightforward.
 *
 * Required env:
 *   - RESEND_API_KEY
 *   - RESEND_FROM_EMAIL  (must be a verified sender on a verified domain)
 *
 * When the API key is missing we degrade gracefully — the call returns
 * `false` and we log a warning, so flows that depend on email don't
 * crash the whole request.
 */
@Injectable()
export class EmailSenderService {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('RESEND_API_KEY') &&
        this.configService.get<string>('RESEND_FROM_EMAIL'),
    );
  }

  async sendEmail(payload: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `Email skipped (Resend not configured): to=${payload.to} subject="${payload.subject}"`,
      );
      return false;
    }
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
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          reply_to: payload.replyTo,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(
          `Resend send failed (${response.status}): ${errorText.slice(0, 240)}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Resend send threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
