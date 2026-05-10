import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.schema';
import { AccessControlModule } from './shared/access-control/access-control.module';
import { SecurityModule } from './shared/security/security.module';
import { EngineModule } from './modules/engine/engine.module';
import { CoworkerModule } from './modules/coworker/coworker.module';
import { HealthModule } from './modules/health/health.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RecordsModule } from './modules/records/records.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { SystemsModule } from './modules/systems/systems.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { FilesModule } from './modules/files/files.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RunnerModule } from './modules/runner/runner.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    AccessControlModule,
    SecurityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '.env.example'],
      validate: validateEnv,
      expandVariables: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: configService.get<number>('THROTTLE_LIMIT', 60),
        },
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        username: configService.get<string>('DATABASE_USER', 'postgres'),
        password: configService.get<string>('DATABASE_PASSWORD', 'postgres'),
        database: configService.get<string>('DATABASE_NAME', 'stack62'),
        autoLoadEntities: true,
        synchronize: configService.get<boolean>('DATABASE_SYNC', true),
        logging: configService.get<boolean>('DATABASE_LOGGING', false),
        ssl: configService.get<boolean>('DATABASE_SSL', false)
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          db: configService.get<number>('REDIS_DB', 0),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          skipVersionCheck: configService.get<boolean>(
            'REDIS_SKIP_VERSION_CHECK',
            true,
          ),
        },
      }),
    }),
    HealthModule,
    ActivityModule,
    AuditModule,
    JobsModule,
    AiModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    WorkspacesModule,
    MembershipsModule,
    SystemsModule,
    PermissionsModule,
    SharingModule,
    WorkflowsModule,
    RecordsModule,
    TasksModule,
    SchedulesModule,
    FilesModule,
    DocumentsModule,
    ReportsModule,
    SearchModule,
    RunnerModule,
    IntegrationsModule,
    EngineModule,
    CoworkerModule,
  ],
})
export class AppModule {}
