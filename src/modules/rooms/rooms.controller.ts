import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CreateRoomDto, PostMessageDto } from './dto/rooms.dtos';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  /**
   * List all rooms the caller is a member of. Optionally filter to a
   * single organization via `?organizationId=`.
   */
  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService.listMyRooms(organizationId, user.userId);
  }

  /**
   * Channels discoverable by anyone in the org (independent of
   * membership) — for the "browse channels to join" UI.
   */
  @Get('channels')
  listChannels(@Query('organizationId') organizationId: string) {
    return this.roomsService.listChannels(organizationId);
  }

  /**
   * "Step out into the private Coworker 1:1" — idempotent. Always
   * returns the same private room for (user, org).
   */
  @Post('coworker-private')
  openPrivate(
    @Body() body: { organizationId: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService.getOrCreatePrivateCoworkerRoom(
      body.organizationId,
      user.userId,
    );
  }

  @Post()
  create(@Body() body: CreateRoomDto, @CurrentUser() user: JwtUser) {
    return this.roomsService.createRoom(body, user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.roomsService.getRoom(id, user.userId);
  }

  @Get(':id/members')
  members(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.roomsService.listMembers(id, user.userId);
  }

  @Get(':id/messages')
  messages(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @Query('before') before: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService.listMessages(id, user.userId, {
      limit: limit ? Number(limit) : 50,
      before,
    });
  }

  @Post(':id/messages')
  post(
    @Param('id') id: string,
    @Body() body: PostMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService.postMessage(id, body, user.userId);
  }

  @Post(':id/read')
  read(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.roomsService
      .markRead(id, user.userId)
      .then(() => ({ ok: true }));
  }

  @Post(':id/members/:userId')
  addMember(
    @Param('id') roomId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService.addMember(roomId, userId, user.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') roomId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.roomsService
      .removeMember(roomId, userId, user.userId)
      .then(() => ({ ok: true }));
  }
}
