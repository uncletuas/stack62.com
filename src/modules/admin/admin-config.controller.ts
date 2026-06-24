import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { PlatformRoles } from '../../shared/access-control/platform-role.decorator';
import { AdminConfigService } from './admin-config.service';
import type { PlatformConfigCategory } from './entities/platform-config.entity';

@ApiTags('admin')
@ApiBearerAuth()
@PlatformRoles('engineer')
@Controller('admin/config')
export class AdminConfigController {
  constructor(private readonly config: AdminConfigService) {}

  @Get()
  list(@Query('category') category?: string) {
    return this.config.list({ category });
  }

  @Post()
  upsert(
    @Body()
    body: {
      key: string;
      value: string | null;
      category?: PlatformConfigCategory;
      description?: string | null;
      isSecret?: boolean;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.config.upsert(body, user.userId);
  }

  @Post(':key/rollback')
  rollback(@Param('key') key: string, @CurrentUser() user: JwtUser) {
    return this.config.rollback(key, user.userId);
  }
}
