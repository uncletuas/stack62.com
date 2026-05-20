import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { ActivityModule } from '../activity/activity.module';
import { WorkspaceActionLogEntity } from './entities/workspace-action-log.entity';
import { WorkspaceDocEntity } from './entities/workspace-doc.entity';
import { WorkspaceStateController } from './workspace-state.controller';
import { WorkspaceStateService } from './workspace-state.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceDocEntity, WorkspaceActionLogEntity]),
    AccessControlModule,
    ActivityModule,
  ],
  controllers: [WorkspaceStateController],
  providers: [WorkspaceStateService],
  exports: [WorkspaceStateService],
})
export class WorkspaceStateModule {}
