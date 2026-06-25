import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { RequireCapability } from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminIntegrationsService } from './admin-integrations.service';

@ApiTags('admin-integrations')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get('providers')
  @RequireCapability('integrations.read')
  providers() {
    return this.integrations.providers();
  }

  @Get('connections')
  @RequireCapability('integrations.read')
  connections(@Query('provider') provider?: string) {
    return this.integrations.connectionsList({ provider });
  }

  @Get('webhooks')
  @RequireCapability('integrations.read')
  webhooks() {
    return this.integrations.webhookFeed();
  }
}
