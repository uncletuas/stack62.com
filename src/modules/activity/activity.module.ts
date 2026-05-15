import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { AuditRetentionCron } from './audit-retention.cron';
import { ActivityLogEntity } from './entities/activity-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityLogEntity])],
  controllers: [ActivityController],
  providers: [ActivityService, AuditRetentionCron],
  exports: [ActivityService],
})
export class ActivityModule {}
