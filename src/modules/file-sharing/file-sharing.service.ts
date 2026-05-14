import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { FilesService } from '../files/files.service';
import { FileShareEntity } from '../files/entities/file-share.entity';
import { FoldersService } from '../folders/folders.service';
import { UsersService } from '../users/users.service';
import { EmailSenderService } from './email-sender.service';
import type { FolderPermission } from '../folders/entities/folder-acl.entity';

/**
 * File-level sharing — orthogonal to folder ACLs. A user can share a
 * single file with a specific person (by email or user id) or with a
 * public token-link, without granting any folder-level access.
 *
 * Recipients who already have Stack62 accounts see the share in their
 * "Shared with me" view immediately. Recipients who don't get an email
 * via Resend; when they sign up with that email, the existing share
 * row is re-linked to their new user id.
 */
@Injectable()
export class FileSharingService {
  private readonly logger = new Logger(FileSharingService.name);

  constructor(
    @InjectRepository(FileShareEntity)
    private readonly sharesRepo: Repository<FileShareEntity>,
    private readonly filesService: FilesService,
    private readonly foldersService: FoldersService,
    private readonly usersService: UsersService,
    private readonly emailSender: EmailSenderService,
    private readonly activityService: ActivityService,
    private readonly configService: ConfigService,
  ) {}

  // ── Create ───────────────────────────────────────────────────────────

  async createShare(
    payload: {
      fileId: string;
      targetEmail?: string;
      targetUserId?: string;
      permission: FolderPermission;
      expiresInDays?: number;
      message?: string;
      asPublicLink?: boolean;
    },
    actorUserId: string,
  ): Promise<{
    share: FileShareEntity;
    inviteUrl: string | null;
    emailed: boolean;
  }> {
    const file = await this.filesService.findOne(payload.fileId, actorUserId);

    // The actor must have at least `share` permission on the file. If
    // it's in a folder, defer to folder ACL; otherwise fall back to
    // "uploader owns it" — uploader can share.
    if (file.folderId) {
      await this.foldersService.assertPermission(
        file.folderId,
        actorUserId,
        'share',
      );
    } else if (file.uploadedByUserId !== actorUserId) {
      // For root-level files, only the uploader can share. Org admins
      // are covered via folder permission checks if we move the file
      // into a folder later.
      throw new BadRequestException(
        'You can only share files you uploaded, or move them into a folder where you have share permission.',
      );
    }

    if (!payload.targetEmail && !payload.targetUserId && !payload.asPublicLink) {
      throw new BadRequestException(
        'Provide targetEmail, targetUserId, or asPublicLink=true.',
      );
    }

    // Resolve targetEmail → targetUserId when possible.
    let targetUserId = payload.targetUserId ?? null;
    let targetEmail = payload.targetEmail?.trim().toLowerCase() ?? null;
    if (!targetUserId && targetEmail) {
      const user = await this.usersService.findByEmail(targetEmail);
      if (user) targetUserId = user.id;
    }

    const expiresAt = payload.expiresInDays
      ? new Date(Date.now() + payload.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const shareToken = payload.asPublicLink
      ? crypto.randomBytes(32).toString('hex')
      : null;

    const share = await this.sharesRepo.save(
      this.sharesRepo.create({
        fileId: payload.fileId,
        targetUserId,
        targetEmail,
        permission: payload.permission,
        shareToken,
        sharedByUserId: actorUserId,
        expiresAt,
        optionalMessage: payload.message ?? null,
      }),
    );

    const inviteUrl = shareToken
      ? `${this.appUrl()}/share/${shareToken}`
      : null;

    // Email path — only if we have an email *and* there's no public
    // token (public tokens are a separate flow where the sharer copies
    // the link themselves).
    let emailed = false;
    if (targetEmail && !shareToken) {
      const isNewUser = !targetUserId;
      emailed = await this.sendShareEmail({
        toEmail: targetEmail,
        senderName: await this.lookupSenderName(actorUserId),
        fileName: file.filename,
        message: payload.message ?? null,
        actionUrl: isNewUser
          ? `${this.appUrl()}/signup?invite_email=${encodeURIComponent(targetEmail)}`
          : `${this.appUrl()}/app?shared=${share.id}`,
        ctaLabel: isNewUser ? 'Create your Stack62 account' : 'Open the file',
      });
    }

    await this.activityService.log({
      organizationId: file.organizationId,
      workspaceId: file.workspaceId ?? null,
      actorUserId,
      action: 'file.share',
      targetType: 'file',
      targetId: file.id,
      origin: 'user',
      metadata: {
        permission: share.permission,
        targetEmail,
        targetUserId,
        publicLink: Boolean(shareToken),
      },
    });

    return { share, inviteUrl, emailed };
  }

  // ── Read ─────────────────────────────────────────────────────────────

  async listSharesForFile(fileId: string, actorUserId: string) {
    await this.filesService.findOne(fileId, actorUserId);
    return this.sharesRepo.find({
      where: { fileId },
      order: { createdAt: 'DESC' },
    });
  }

  async listSharedWithMe(actorUserId: string) {
    const rows = await this.sharesRepo.find({
      where: { targetUserId: actorUserId },
      order: { createdAt: 'DESC' },
    });
    // Filter out expired shares.
    const now = new Date();
    return rows.filter((r) => !r.expiresAt || r.expiresAt > now);
  }

  async lookupByToken(token: string) {
    const share = await this.sharesRepo.findOne({
      where: { shareToken: token },
    });
    if (!share) throw new NotFoundException('Share link not found.');
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new NotFoundException('Share link expired.');
    }
    return share;
  }

  async revoke(shareId: string, actorUserId: string) {
    const share = await this.sharesRepo.findOne({ where: { id: shareId } });
    if (!share) throw new NotFoundException('Share not found.');
    if (share.sharedByUserId !== actorUserId) {
      // Anyone who can share the file can revoke shares too.
      const file = await this.filesService.findOne(share.fileId, actorUserId);
      if (file.folderId) {
        await this.foldersService.assertPermission(
          file.folderId,
          actorUserId,
          'share',
        );
      }
    }
    await this.sharesRepo.delete({ id: shareId });
  }

  /**
   * Called from the auth flow when a new user signs up — claim any
   * outstanding shares addressed to their email.
   */
  async attachPendingSharesForUser(
    userId: string,
    email: string,
  ): Promise<number> {
    const result = await this.sharesRepo.update(
      { targetEmail: email.toLowerCase(), targetUserId: undefined },
      { targetUserId: userId },
    );
    return result.affected ?? 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private appUrl(): string {
    return (
      this.configService.get<string>('APP_PUBLIC_URL') ||
      'http://localhost:5173'
    );
  }

  private async lookupSenderName(userId: string): Promise<string> {
    try {
      const user = await this.usersService.findById(userId);
      return `${user.firstName} ${user.lastName}`.trim() || 'A Stack62 user';
    } catch {
      return 'A Stack62 user';
    }
  }

  private async sendShareEmail(params: {
    toEmail: string;
    senderName: string;
    fileName: string;
    message: string | null;
    actionUrl: string;
    ctaLabel: string;
  }): Promise<boolean> {
    const subject = `${params.senderName} shared "${params.fileName}" with you`;
    const messageBlock = params.message
      ? `<blockquote style="margin:24px 0;padding:12px 16px;background:#f7f7f8;border-left:3px solid #888;color:#444;font-style:italic;">${escapeHtml(params.message)}</blockquote>`
      : '';
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 8px 0;font-weight:600;">A file is waiting for you on Stack62</h2>
        <p style="color:#555;margin:0 0 16px 0;">${escapeHtml(params.senderName)} shared <strong>${escapeHtml(params.fileName)}</strong> with you.</p>
        ${messageBlock}
        <p style="margin:24px 0;"><a href="${params.actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:500;">${escapeHtml(params.ctaLabel)}</a></p>
        <p style="color:#888;font-size:12px;margin-top:32px;">If you weren't expecting this email you can safely ignore it. Stack62 — AI-native operating systems for business.</p>
      </div>
    `;
    return this.emailSender.sendEmail({
      to: params.toEmail,
      subject,
      html,
      text: `${params.senderName} shared "${params.fileName}" with you.\n\n${
        params.message ?? ''
      }\n\n${params.ctaLabel}: ${params.actionUrl}`,
    });
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
