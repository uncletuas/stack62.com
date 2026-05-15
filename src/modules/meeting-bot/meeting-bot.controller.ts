import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { MeetingBotService } from './meeting-bot.service';
import type { MeetingBotSessionEntity } from './entities/meeting-bot-session.entity';

class ScheduleMeetingDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsUrl()
  meetingUrl!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;
}

class TranscriptChunkDto {
  @IsOptional()
  @IsString()
  speakerLabel?: string;

  @IsString()
  text!: string;

  @IsOptional()
  startsAtSec?: number;
}

class AppendTranscriptDto {
  @IsArray()
  @ArrayMaxSize(200)
  chunks!: TranscriptChunkDto[];
}

@ApiTags('meeting-bot')
@Controller('meeting-bot')
export class MeetingBotController {
  constructor(
    private readonly service: MeetingBotService,
    private readonly jwt: JwtService,
  ) {}

  // ── User-facing ─────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Post('sessions')
  schedule(@Body() body: ScheduleMeetingDto, @CurrentUser() user: JwtUser) {
    return this.service.schedule({
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      meetingUrl: body.meetingUrl,
      title: body.title,
      roomId: body.roomId,
      requestedByUserId: user.userId,
    });
  }

  @ApiBearerAuth()
  @Get('sessions')
  list(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listForUser(organizationId, user.userId);
  }

  @ApiBearerAuth()
  @Get('sessions/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.findById(id, user.userId);
  }

  @ApiBearerAuth()
  @Get('sessions/:id/transcript')
  transcript(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.getTranscript(id, user.userId);
  }

  // ── Worker callbacks ────────────────────────────────────────────────
  // The worker authenticates with a session-scoped short-lived JWT we
  // minted at schedule time (scope=meeting-bot.worker, sessionId=<id>).
  // We never accept a normal user JWT on these routes.

  @Public()
  @Post('worker/:id/status')
  async workerStatus(
    @Param('id') sessionId: string,
    @Headers('authorization') auth: string,
    @Body() body: { status: MeetingBotSessionEntity['status']; errorMessage?: string },
  ) {
    this.verifyWorkerToken(auth, sessionId);
    if (!body.status) throw new BadRequestException('status required.');
    await this.service.markStatus(sessionId, body.status, {
      errorMessage: body.errorMessage,
    });
    return { ok: true };
  }

  @Public()
  @Post('worker/:id/transcript')
  async workerTranscript(
    @Param('id') sessionId: string,
    @Headers('authorization') auth: string,
    @Body() body: AppendTranscriptDto,
  ) {
    this.verifyWorkerToken(auth, sessionId);
    await this.service.appendTranscript(sessionId, body.chunks);
    return { ok: true, accepted: body.chunks.length };
  }

  @Public()
  @Post('worker/:id/complete')
  async workerComplete(
    @Param('id') sessionId: string,
    @Headers('authorization') auth: string,
  ) {
    this.verifyWorkerToken(auth, sessionId);
    await this.service.completeSession(sessionId);
    return { ok: true };
  }

  private verifyWorkerToken(authHeader: string, sessionId: string): void {
    const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException();
    try {
      const payload = this.jwt.verify<{
        scope?: string;
        sessionId?: string;
      }>(token);
      if (
        payload.scope !== 'meeting-bot.worker' ||
        payload.sessionId !== sessionId
      ) {
        throw new UnauthorizedException();
      }
    } catch {
      throw new UnauthorizedException();
    }
  }
}
