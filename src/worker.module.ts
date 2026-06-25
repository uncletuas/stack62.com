import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolvePostgres, resolveRedis } from './config/connection-urls';
import { validateEnv } from './config/env.schema';
import { AccessControlModule } from './shared/access-control/access-control.module';
import { AiWorkerModule } from './modules/ai/ai-worker.module';
import { CoworkerModule } from './modules/coworker/coworker.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    AccessControlModule,
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '.env.example'],
      validate: validateEnv,
      expandVariables: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const pg = resolvePostgres();
        return {
          type: 'postgres',
          host: pg.host,
          port: pg.port,
          username: pg.username,
          password: pg.password,
          database: pg.database,
          autoLoadEntities: true,
          synchronize: configService.get<boolean>('DATABASE_SYNC', true),
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
    AiWorkerModule,
    CoworkerModule,
    ReportsModule,
  ],
})
export class WorkerModule {}
