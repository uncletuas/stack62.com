import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminContentService } from './admin-content.service';
import type {
  AnnouncementChannel,
  AnnouncementStatus,
} from './entities/announcement.entity';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('support_manager')
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('announcements')
  list(@Query('status') status?: string, @Query('channel') channel?: string) {
    return this.content.list({ status, channel });
  }

  @Post('announcements')
  create(
    @Body()
    body: {
      title: string;
      body: string;
      channel?: AnnouncementChannel;
      audience?: Record<string, unknown> | null;
      scheduledFor?: string | null;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.content.create(body, user.userId);
  }

  @Patch('announcements/:id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      body?: string;
      status?: AnnouncementStatus;
      scheduledFor?: string | null;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.content.update(id, body, user.userId);
  }
}
