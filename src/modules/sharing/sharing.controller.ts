import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateSharePackageDto } from './dto/create-share-package.dto';
import { ListSharePackagesDto } from './dto/list-share-packages.dto';
import { SharingService } from './sharing.service';

@ApiTags('sharing')
@ApiBearerAuth()
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharingService: SharingService) {}

  @RequireAccess({
    resource: 'share_package',
    action: 'share',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId' },
  })
  @Post('packages')
  create(@Body() payload: CreateSharePackageDto, @CurrentUser() user: JwtUser) {
    return this.sharingService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'share_package',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('packages')
  findAll(@Query() query: ListSharePackagesDto, @CurrentUser() user: JwtUser) {
    return this.sharingService.findAll(query, user.userId);
  }
}
