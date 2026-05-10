import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { ActivityLogEntity } from '../activity/entities/activity-log.entity';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { ReportEntity } from './entities/report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportEntity,
      TaskEntity,
      RuntimeRecordEntity,
      ActivityLogEntity,
    ]),
    ActivityModule,
    AuditModule,
    DocumentsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
