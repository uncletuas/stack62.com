import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { SettingsService } from './settings.service';

class UpsertSettingDto {
  @IsString()
  @Length(1, 160)
  key!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

@ApiTags('admin-config')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/config')
export class AdminConfigController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequireCapability('config.read')
  list() {
    return this.settingsService.list();
  }

  @Post()
  @RequireCapability('config.edit')
  async upsert(
    @Body() dto: UpsertSettingDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    const view = await this.settingsService.upsert(
      dto.key,
      dto.value,
      actor.staffId,
      {
        category: dto.category,
        isSecret: dto.isSecret,
        description: dto.description,
      },
    );
    // Never record the value — note only the key + whether it was a secret.
    await this.auditService.log({
      actorUserId: actor.staffId,
      action: 'admin.config.upsert',
      targetType: 'platform_setting',
      targetId: dto.key,
      origin: 'system',
      metadata: { isSecret: view.isSecret, actorRole: actor.role },
    });
    return view;
  }

  @Delete(':key')
  @RequireCapability('config.edit')
  async clear(
    @Param('key') key: string,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    await this.settingsService.clear(key);
    await this.auditService.log({
      actorUserId: actor.staffId,
      action: 'admin.config.clear',
      targetType: 'platform_setting',
      targetId: key,
      origin: 'system',
      metadata: { actorRole: actor.role },
    });
    return { ok: true };
  }
}
