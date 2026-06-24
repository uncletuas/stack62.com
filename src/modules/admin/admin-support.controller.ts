import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminSupportService } from './admin-support.service';
import type {
  SupportTicketPriority,
  SupportTicketStatus,
} from './entities/support-ticket.entity';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('support_manager', 'operations_manager')
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: AdminSupportService) {}

  @Get('tickets')
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.support.list({
      status,
      priority,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('stats')
  stats() {
    return this.support.stats();
  }

  @Post('tickets')
  create(
    @Body()
    body: {
      subject: string;
      body?: string;
      priority?: SupportTicketPriority;
      organizationId?: string;
      requesterUserId?: string;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.support.create(body, user.userId);
  }

  @Patch('tickets/:id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      status?: SupportTicketStatus;
      priority?: SupportTicketPriority;
      assigneeUserId?: string | null;
      csatScore?: number | null;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.support.update(id, body, user.userId);
  }
}
