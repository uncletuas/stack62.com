import { Controller, Get, Header, Logger, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { ActivityService } from '../activity/activity.service';
import { UserEntity } from './entities/user.entity';

/**
 * GDPR-style "give me everything you know about me" export. Bundles
 * every row in the database that references the authenticated user
 * into a single JSON payload and serves it as a download.
 *
 * Scope:
 *   - Profile (user row, redacted password hash)
 *   - Memberships (which orgs they belong to)
 *   - Activity log entries actored by them
 *   - Coworker conversations they took part in
 *   - File shares they sent or received
 *
 * Intentionally NOT included:
 *   - Org-level data they don't own (would leak other members' info)
 *   - Files they uploaded — those have their own download path
 *
 * Note: this is a self-serve export, not a full org-level GDPR audit.
 * For "give me everything about org X" the org owner has access via
 * the same controller scoped by orgId — to be added when the first
 * compliance customer asks.
 */
@ApiTags('account-data')
@ApiBearerAuth()
@Controller('account')
export class DataExportController {
  private readonly logger = new Logger(DataExportController.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly activity: ActivityService,
  ) {}

  @Get('export')
  @Header('Content-Type', 'application/json')
  @Header(
    'Content-Disposition',
    'attachment; filename="stack62-data-export.json"',
  )
  async export(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const userRow = await this.usersRepo.findOne({
      where: { id: user.userId },
    });
    if (!userRow) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const safeUser = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.firstName,
      lastName: userRow.lastName,
      status: userRow.status,
      emailVerifiedAt: userRow.emailVerifiedAt,
      createdAt: userRow.createdAt,
      updatedAt: userRow.updatedAt,
    };

    const memberships = await this.dataSource.query(
      `SELECT id, organization_id, workspace_id, role, status, created_at
       FROM memberships
       WHERE user_id = $1`,
      [user.userId],
    );

    const activity = await this.dataSource.query(
      `SELECT id, action, target_type, target_id, organization_id, workspace_id, metadata, created_at
       FROM activity_logs
       WHERE actor_user_id = $1
       ORDER BY created_at DESC
       LIMIT 5000`,
      [user.userId],
    );

    const conversations = await this.dataSource.query(
      `SELECT id, organization_id, workspace_id, title, created_at, updated_at
       FROM coworker_conversations
       WHERE actor_user_id = $1
       ORDER BY created_at DESC
       LIMIT 1000`,
      [user.userId],
    );

    const sharesSent = await this.dataSource.query(
      `SELECT id, file_id, target_email, target_user_id, permission, created_at
       FROM file_shares
       WHERE shared_by_user_id = $1`,
      [user.userId],
    );
    const sharesReceived = await this.dataSource.query(
      `SELECT id, file_id, shared_by_user_id, permission, created_at
       FROM file_shares
       WHERE target_user_id = $1`,
      [user.userId],
    );

    const payload = {
      schema: 'stack62-data-export-v1',
      exportedAt: new Date().toISOString(),
      user: safeUser,
      memberships,
      activity,
      conversations,
      fileShares: { sent: sharesSent, received: sharesReceived },
      notes: [
        'This is a self-serve user export. Files you uploaded are not included here — use the API or the Files surface to download them.',
        'Org-scoped data (system definitions, other members) is intentionally omitted.',
      ],
    };

    await this.activity.log({
      actorUserId: user.userId,
      action: 'account.data_export',
      targetType: 'user',
      targetId: user.userId,
      origin: 'user',
      metadata: {
        rows: {
          memberships: memberships.length,
          activity: activity.length,
          conversations: conversations.length,
          sharesSent: sharesSent.length,
          sharesReceived: sharesReceived.length,
        },
      },
    });

    res.status(200).send(JSON.stringify(payload, null, 2));
  }
}
