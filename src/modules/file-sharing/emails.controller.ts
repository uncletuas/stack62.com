import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { ActivityService } from '../activity/activity.service';
import { EmailSenderService } from './email-sender.service';

class SendEmailDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  to!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;
}

/**
 * Plain-email endpoint for the front-end Compose UI. The Coworker tool
 * (email.send) goes through the same EmailSenderService.
 */
@ApiTags('emails')
@ApiBearerAuth()
@Controller('emails')
export class EmailsController {
  constructor(
    private readonly sender: EmailSenderService,
    private readonly activity: ActivityService,
  ) {}

  @Post()
  async send(@Body() body: SendEmailDto, @CurrentUser() user: JwtUser) {
    if (!this.sender.isConfigured()) {
      throw new BadRequestException(
        'Email provider not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.',
      );
    }
    let sent = 0;
    for (const to of body.to) {
      const ok = await this.sender.sendEmail({
        to,
        subject: body.subject,
        text: body.body,
        html: htmlBody(body.body),
        replyTo: body.replyTo,
      });
      if (ok) sent++;
    }
    await this.activity.log({
      actorUserId: user.userId,
      action: 'email.send',
      targetType: 'email',
      targetId: 'composer',
      origin: 'user',
      metadata: {
        recipients: body.to.length,
        sent,
        subject: body.subject.slice(0, 80),
      },
    });
    return { sent, recipients: body.to };
  }
}

function htmlBody(text: string): string {
  const escape = (input: string) =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const paras = text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">${paras}<p style="margin-top:32px;color:#888;font-size:12px;">Sent via Stack62.</p></div>`;
}
