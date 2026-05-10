import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@Body() payload: CreateOrganizationDto, @CurrentUser() user: JwtUser) {
    return this.organizationsService.create(payload, user.userId);
  }

  @RequireAccess({
    resource: 'organization',
    action: 'read',
    allowUnscoped: true,
  })
  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.organizationsService.findAll(user.userId);
  }

  @Patch(':id/settings')
  updateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.organizationsService.updateSettings(id, dto, user.userId);
  }
}
