import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { ActivityModule } from '../activity/activity.module';
import { WorkspaceActionLogEntity } from './entities/workspace-action-log.entity';
import { WorkspaceDocEntity } from './entities/workspace-doc.entity';
import { WorkspaceRealtimeService } from './workspace-realtime.service';
import { WorkspaceStateController } from './workspace-state.controller';
import { WorkspaceStateService } from './workspace-state.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceDocEntity, WorkspaceActionLogEntity]),
    AccessControlModule,
    ActivityModule,
    // JwtModule registered locally with the same secret as Auth so
    // WorkspaceRealtimeService can verify provider tokens without
    // pulling AuthModule (which would create a forward-ref chain).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>(
          'JWT_SECRET',
          'stack62-local-development-secret',
        ),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') as never,
        },
      }),
    }),
  ],
  controllers: [WorkspaceStateController],
  providers: [WorkspaceStateService, WorkspaceRealtimeService],
  exports: [WorkspaceStateService, WorkspaceRealtimeService],
})
export class WorkspaceStateModule {}
