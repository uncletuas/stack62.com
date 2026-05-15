import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../../shared/access-control/access-control.module';
import { ActivityModule } from '../activity/activity.module';
import { MeetingBotSessionEntity } from './entities/meeting-bot-session.entity';
import { MeetingBotTranscriptEntity } from './entities/meeting-bot-transcript.entity';
import { MEETING_BOT_QUEUE } from './meeting-bot.constants';
import { MeetingBotController } from './meeting-bot.controller';
import { MeetingBotService } from './meeting-bot.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: MEETING_BOT_QUEUE }),
    TypeOrmModule.forFeature([
      MeetingBotSessionEntity,
      MeetingBotTranscriptEntity,
    ]),
    AccessControlModule,
    ActivityModule,
    // Local JwtModule with the same secret as Auth, used to verify
    // worker tokens. We can't inject AuthModule here without a
    // forwardRef chain, so we re-register against the same secret.
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
  controllers: [MeetingBotController],
  providers: [MeetingBotService],
  exports: [MeetingBotService],
})
export class MeetingBotModule {}
