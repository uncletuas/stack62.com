import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminAiService } from './admin-ai.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('engineer')
@Controller('admin/ai')
export class AdminAiController {
  constructor(private readonly ai: AdminAiService) {}

  @Get('usage')
  usage() {
    return this.ai.usageSummary();
  }

  @Get('logs')
  logs(
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.ai.listLogs({
      status,
      provider,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
