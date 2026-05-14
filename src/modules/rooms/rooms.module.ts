import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import { SlackModule } from '../slack/slack.module';
import { RoomMemberEntity } from './entities/room-member.entity';
import { RoomMessageEntity } from './entities/room-message.entity';
import { RoomEntity } from './entities/room.entity';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoomEntity,
      RoomMemberEntity,
      RoomMessageEntity,
      MembershipEntity,
    ]),
    ActivityModule,
    forwardRef(() => SlackModule),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
