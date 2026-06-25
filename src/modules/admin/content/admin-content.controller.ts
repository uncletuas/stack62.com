import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { CurrentStaff, RequireCapability } from '../admin.decorators';
import type { AuthenticatedStaff } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminContentService } from './admin-content.service';
import type {
  AnnouncementChannel,
  AnnouncementStatus,
} from '../entities/announcement.entity';

@ApiTags('admin-content')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get('announcements')
  @RequireCapability('content.read')
  list(@Query('status') status?: string, @Query('channel') channel?: string) {
    return this.content.list({ status, channel });
  }

  @Post('announcements')
  @RequireCapability('content.edit')
  create(
    @Body()
    body: {
      title: string;
      body: string;
      channel?: AnnouncementChannel;
      audience?: Record<string, unknown> | null;
      scheduledFor?: string | null;
    },
    @CurrentStaff() staff: AuthenticatedStaff,
  ) {
    return this.content.create(body, staff.staffId);
  }

  @Patch('announcements/:id')
  @RequireCapability('content.edit')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string;
      body?: string;
      status?: AnnouncementStatus;
      scheduledFor?: string | null;
    },
  ) {
    return this.content.update(id, body);
  }
}
