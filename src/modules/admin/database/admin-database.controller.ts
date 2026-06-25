import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../shared/decorators/public.decorator';
import { AuditService } from '../../audit/audit.service';
import {
  type AuthenticatedStaff,
  CurrentStaff,
  RequireCapability,
} from '../admin.decorators';
import { PlatformStaffGuard } from '../platform-staff.guard';
import { AdminDatabaseService } from './admin-database.service';

@ApiTags('admin-database')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformStaffGuard)
@Controller('admin/database')
export class AdminDatabaseController {
  constructor(
    private readonly databaseService: AdminDatabaseService,
    private readonly auditService: AuditService,
  ) {}

  @Get('status')
  @RequireCapability('database.read')
  status() {
    return this.databaseService.status();
  }

  @Get('tables')
  @RequireCapability('database.read')
  tables() {
    return this.databaseService.tableStats();
  }

  /** Stream a logical JSON backup of the critical tables as a download. */
  @Get('backup')
  @RequireCapability('database.backup')
  async backup(
    @CurrentStaff() actor: AuthenticatedStaff,
    @Res() res: Response,
  ) {
    const { filename, payload } = await this.databaseService.buildBackup();
    await this.auditService.log({
      actorUserId: actor.staffId,
      action: 'admin.database.backup',
      targetType: 'database',
      targetId: 'snapshot',
      origin: 'system',
      metadata: { filename, bytes: payload.length, actorRole: actor.role },
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(payload);
  }
}
