import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SystemsModule } from '../systems/systems.module';
import { CodeGeneratorService } from './code-generator.service';
import { SystemDeploymentEntity } from './entities/system-deployment.entity';
import { RunnerController } from './runner.controller';
import { RunnerEventsService } from './runner-events.service';
import { RunnerProxyController } from './runner-proxy.controller';
import { RunnerService } from './runner.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemDeploymentEntity]),
    AiModule,
    OrganizationsModule,
    SystemsModule,
    // JwtModule is needed by the proxy controller to verify preview tokens
    // without requiring the full AuthModule import chain.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>(
          'JWT_SECRET',
          'stack62-local-development-secret',
        ),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1d') as never,
        },
      }),
    }),
  ],
  controllers: [RunnerController, RunnerProxyController],
  providers: [CodeGeneratorService, RunnerEventsService, RunnerService],
  exports: [CodeGeneratorService, RunnerEventsService, RunnerService],
})
export class RunnerModule {}
