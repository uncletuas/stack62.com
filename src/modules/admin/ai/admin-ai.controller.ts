import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { RequireCapability } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminAiService } from './admin-ai.service';

@ApiTags('admin-ai')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/ai')
export class AdminAiController {
  constructor(private readonly aiService: AdminAiService) {}

  @Get('usage')
  @RequireCapability('ai.read')
  usage() {
    return this.aiService.usage();
  }

  @Get('logs')
  @RequireCapability('ai.read')
  logs(
    @Query('provider') provider?: string,
    @Query('status') status?: string,
  ) {
    return this.aiService.recent({ provider, status });
  }
}
