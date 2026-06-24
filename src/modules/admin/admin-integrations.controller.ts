import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminIntegrationsService } from './admin-integrations.service';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('engineer')
@Controller('admin/integrations')
export class AdminIntegrationsController {
  constructor(private readonly integrations: AdminIntegrationsService) {}

  @Get('providers')
  providers() {
    return this.integrations.providerSummary();
  }

  @Get('connections')
  connections(
    @Query('provider') provider?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.integrations.listConnections({
      provider,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
