import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolvePostgres, resolveRedis } from './config/connection-urls';
import { validateEnv } from './config/env.schema';
import { CryptoModule } from './shared/crypto/crypto.module';
import { AccessControlModule } from './shared/access-control/access-control.module';
import { SecurityModule } from './shared/security/security.module';
import { SystemControlModule } from './shared/system-control/system-control.module';
import { SystemControlMiddleware } from './shared/system-control/system-control.middleware';
import { EngineModule } from './modules/engine/engine.module';
import { BrowserModule } from './modules/browser/browser.module';
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
import { WorkspaceStateModule } from './modules/workspace-state/workspace-state.module';
import { DocumentExtractionModule } from './modules/document-extraction/document-extraction.module';
import { FileSharingModule } from './modules/file-sharing/file-sharing.module';
import { FilesModule } from './modules/files/files.module';
import { FoldersModule } from './modules/folders/folders.module';
import { MeetingBotModule } from './modules/meeting-bot/meeting-bot.module';
import { RealtimeVoiceModule } from './modules/realtime-voice/realtime-voice.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { SemanticSearchModule } from './modules/semantic-search/semantic-search.module';
import { StreamingGenerationModule } from './modules/streaming-generation/streaming-generation.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RunnerModule } from './modules/runner/runner.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { EmailInboxModule } from './modules/email-inbox/email-inbox.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { BillingModule } from './modules/billing/billing.module';
import { OrgIntelligenceModule } from './modules/org-intelligence/org-intelligence.module';
import { WidgetModule } from './modules/widget/widget.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    AccessControlModule,
    CryptoModule,
    SystemControlModule,
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
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
      useFactory: (configService: ConfigService) => {
        const pg = resolvePostgres();
        // Migration strategy:
        //   - When DATABASE_SYNC=true, TypeORM creates/updates schema
        //     directly. Migrations are SKIPPED in this mode because
        //     existing CREATE TABLE migrations would collide with
        //     the schema synchronize() already produced (Postgres
        //     42P07 "relation already exists").
        //   - When DATABASE_SYNC=false, schema changes go through
        //     migration files and migrationsRun applies them on boot.
        //   - To transition: once schema is settled in dev/prod via
        //     synchronize, mark existing migrations as already-run by
        //     inserting their names into typeorm_migrations, then
        //     flip DATABASE_SYNC=false so future changes go through
        //     migrations exclusively.
        const synchronize = configService.get<boolean>('DATABASE_SYNC', true);
        return {
          type: 'postgres',
          host: pg.host,
          port: pg.port,
          username: pg.username,
          password: pg.password,
          database: pg.database,
          autoLoadEntities: true,
          synchronize,
          migrations: [__dirname + '/migrations/*.{js,ts}'],
          migrationsRun: !synchronize,
          migrationsTableName: 'typeorm_migrations',
          logging: configService.get<boolean>('DATABASE_LOGGING', false),
          ssl: pg.ssl ? { rejectUnauthorized: false } : false,
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = resolveRedis();
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            db: redis.db,
            username: redis.username,
            password: redis.password,
            tls: redis.tls ? {} : undefined,
            skipVersionCheck: configService.get<boolean>(
              'REDIS_SKIP_VERSION_CHECK',
              true,
            ),
          },
        };
      },
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
    WorkspaceStateModule,
    MembershipsModule,
    SystemsModule,
    PermissionsModule,
    SharingModule,
    WorkflowsModule,
    RecordsModule,
    TasksModule,
    SchedulesModule,
    FilesModule,
    FoldersModule,
    DocumentExtractionModule,
    SemanticSearchModule,
    FileSharingModule,
    MeetingBotModule,
    RealtimeVoiceModule,
    RoomsModule,
    StreamingGenerationModule,
    DocumentsModule,
    ReportsModule,
    SearchModule,
    RunnerModule,
    IntegrationsModule,
    EngineModule,
    BrowserModule,
    CoworkerModule,
    EmailInboxModule,
    BillingModule,
    OrgIntelligenceModule,
    WidgetModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  // Apply the runtime emergency controls (maintenance / read-only / rate-limit)
  // across every route. The middleware itself exempts the admin console,
  // health checks and webhooks, and is fail-open.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SystemControlMiddleware).forRoutes('*');
  }
}
