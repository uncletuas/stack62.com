import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.schema';
import { AccessControlModule } from './shared/access-control/access-control.module';
import { AiWorkerModule } from './modules/ai/ai-worker.module';
import { CoworkerModule } from './modules/coworker/coworker.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    AccessControlModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '.env.example'],
      validate: validateEnv,
      expandVariables: true,
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
    AiWorkerModule,
    CoworkerModule,
    ReportsModule,
  ],
})
export class WorkerModule {}
