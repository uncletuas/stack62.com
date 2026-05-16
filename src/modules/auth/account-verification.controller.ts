import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtUser } from './interfaces/jwt-user.interface';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { Public } from '../../shared/decorators/public.decorator';
import { ActivityService } from '../activity/activity.service';
import { EmailSenderService } from '../file-sharing/email-sender.service';
import { UserEntity } from '../users/entities/user.entity';

/**
 * Public endpoints for the "verify your email" and "I forgot my
 * password" flows. Tokens are 32 random bytes hex-encoded; they're
 * 24 hours (verify) / 1 hour (reset) and one-shot.
 *
 * Requires the Resend email integration to actually deliver mail;
 * without it the endpoints still succeed (so the user can't enumerate
 * accounts by timing) but log a warning that the email was skipped.
 */
@ApiTags('account-verification')
@Controller('account')
export class AccountVerificationController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    private readonly email: EmailSenderService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  // ── Email verification ────────────────────────────────────────────

  @Public()
  @Post('send-verification')
  async sendVerification(@Body() body: { email: string }) {
    if (!body.email) throw new BadRequestException('Email required.');
    const user = await this.usersRepo.findOne({
      where: { email: body.email.toLowerCase() },
    });
    // Always 200 to avoid account enumeration. The email is only
    // sent when the user actually exists and isn't already verified.
    if (!user || user.emailVerifiedAt) return { ok: true };

    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );
    await this.usersRepo.save(user);

    const appUrl =
      this.config.get<string>('APP_PUBLIC_URL') || 'http://localhost:5173';
    await this.email.sendEmail({
      to: user.email,
      subject: 'Confirm your Stack62 email',
      text: `Hi ${user.firstName},\n\nConfirm your email by visiting:\n${appUrl}/verify-email?token=${token}\n\nThe link expires in 24 hours.`,
      html: verifyHtml(user.firstName, `${appUrl}/verify-email?token=${token}`),
    });

    return { ok: true };
  }

  @Public()
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    if (!token) throw new BadRequestException('Token required.');
    const user = await this.usersRepo.findOne({
      where: { emailVerificationToken: token },
    });
    if (!user) throw new NotFoundException('Invalid verification token.');
    if (
      user.emailVerificationExpiresAt &&
      user.emailVerificationExpiresAt < new Date()
    ) {
      throw new BadRequestException('Verification token expired.');
    }
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    await this.usersRepo.save(user);

    await this.activity.log({
      actorUserId: user.id,
      action: 'account.email_verified',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });
    return { ok: true, verifiedAt: user.emailVerifiedAt };
  }

  // ── Password reset ────────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    if (!body.email) throw new BadRequestException('Email required.');
    const user = await this.usersRepo.findOne({
      where: { email: body.email.toLowerCase() },
    });
    // Same enumeration-resistance pattern as verification.
    if (!user) return { ok: true };

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.usersRepo.save(user);

    const appUrl =
      this.config.get<string>('APP_PUBLIC_URL') || 'http://localhost:5173';
    await this.email.sendEmail({
      to: user.email,
      subject: 'Reset your Stack62 password',
      text: `Hi ${user.firstName},\n\nReset your password by visiting:\n${appUrl}/reset-password?token=${token}\n\nThe link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
      html: resetHtml(user.firstName, `${appUrl}/reset-password?token=${token}`),
    });

    await this.activity.log({
      actorUserId: user.id,
      action: 'account.password_reset_requested',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });
    return { ok: true };
  }

  /**
   * Authenticated password change. Requires the *current* password
   * so a stolen JWT alone can't rotate it. Logs the rotation to
   * activity so the audit trail shows it.
   */
  @Post('change-password')
  async changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @CurrentUser() actor: JwtUser,
  ) {
    if (!body.currentPassword || !body.newPassword) {
      throw new BadRequestException(
        'currentPassword and newPassword are required.',
      );
    }
    if (body.newPassword.length < 8) {
      throw new BadRequestException(
        'New password must be at least 8 characters.',
      );
    }
    if (body.newPassword === body.currentPassword) {
      throw new BadRequestException(
        'New password must be different from current.',
      );
    }
    const user = await this.usersRepo.findOne({
      where: { id: actor.userId },
    });
    if (!user) throw new NotFoundException('Account not found.');
    const ok = await argon2.verify(user.passwordHash, body.currentPassword);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    user.passwordHash = await argon2.hash(body.newPassword);
    await this.usersRepo.save(user);
    await this.activity.log({
      actorUserId: user.id,
      action: 'account.password_changed',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });
    return { ok: true };
  }

  /**
   * Send the email-verification link to the currently signed-in user.
   * Separate from `send-verification` (which takes an email body) so
   * the UI can offer a "Resend" button without leaking that the email
   * exists.
   */
  @Post('resend-verification')
  async resendVerification(@CurrentUser() actor: JwtUser) {
    const user = await this.usersRepo.findOne({
      where: { id: actor.userId },
    });
    if (!user) throw new NotFoundException('Account not found.');
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );
    await this.usersRepo.save(user);
    const appUrl =
      this.config.get<string>('APP_PUBLIC_URL') || 'http://localhost:5173';
    await this.email.sendEmail({
      to: user.email,
      subject: 'Confirm your Stack62 email',
      text: `Hi ${user.firstName},\n\nConfirm your email by visiting:\n${appUrl}/verify-email?token=${token}\n\nThe link expires in 24 hours.`,
      html: verifyHtml(user.firstName, `${appUrl}/verify-email?token=${token}`),
    });
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  async resetPassword(
    @Body() body: { token: string; password: string },
  ) {
    if (!body.token || !body.password) {
      throw new BadRequestException('Token and password required.');
    }
    if (body.password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters.',
      );
    }
    const user = await this.usersRepo.findOne({
      where: { passwordResetToken: body.token },
    });
    if (!user) throw new NotFoundException('Invalid reset token.');
    if (
      user.passwordResetExpiresAt &&
      user.passwordResetExpiresAt < new Date()
    ) {
      throw new BadRequestException('Reset token expired.');
    }
    user.passwordHash = await argon2.hash(body.password);
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await this.usersRepo.save(user);

    await this.activity.log({
      actorUserId: user.id,
      action: 'account.password_reset',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });
    return { ok: true };
  }
}

function verifyHtml(name: string, url: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 8px 0;">Confirm your email</h2>
      <p>Hi ${escape(name)}, click the button below to confirm your Stack62 account.</p>
      <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500;">Confirm email</a></p>
      <p style="color:#888;font-size:12px;">If the button doesn't work, paste this link into your browser:<br>${url}</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">This link expires in 24 hours.</p>
    </div>
  `;
}

function resetHtml(name: string, url: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 8px 0;">Reset your password</h2>
      <p>Hi ${escape(name)}, click the button below to set a new password.</p>
      <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500;">Reset password</a></p>
      <p style="color:#888;font-size:12px;">If you didn't request this, you can safely ignore the email.</p>
      <p style="color:#888;font-size:12px;margin-top:24px;">This link expires in 1 hour.</p>
    </div>
  `;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
