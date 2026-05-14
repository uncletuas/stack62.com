import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { RoomsModule } from '../rooms/rooms.module';
import { UsersModule } from '../users/users.module';
import { SlackChannelMappingEntity } from './entities/slack-channel-mapping.entity';
import { SlackInstallationEntity } from './entities/slack-installation.entity';
import { SlackMessageLinkEntity } from './entities/slack-message-link.entity';
import { SlackBridgeService } from './slack-bridge.service';
import { SlackController } from './slack.controller';
import { SlackEventsService } from './slack-events.service';
import { SlackOAuthService } from './slack-oauth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SlackInstallationEntity,
      SlackChannelMappingEntity,
      SlackMessageLinkEntity,
    ]),
    ActivityModule,
    forwardRef(() => RoomsModule),
    UsersModule,
  ],
  controllers: [SlackController],
  providers: [SlackOAuthService, SlackBridgeService, SlackEventsService],
  exports: [SlackBridgeService, SlackOAuthService],
})
export class SlackModule {}
