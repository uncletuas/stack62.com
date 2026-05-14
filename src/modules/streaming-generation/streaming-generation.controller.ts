import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { StreamingGenerationService } from './streaming-generation.service';

class StreamGenDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  prompt!: string;

  @IsIn(['text', 'markdown', 'csv', 'json', 'code'])
  outputKind!: 'text' | 'markdown' | 'csv' | 'json' | 'code';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40000)
  priorContent?: string;
}

@ApiTags('streaming-generation')
@ApiBearerAuth()
@Controller('streaming-generation')
export class StreamingGenerationController {
  constructor(
    private readonly streamingGeneration: StreamingGenerationService,
  ) {}

  /**
   * Server-Sent-Events endpoint. The UI POSTs the prompt + outputKind,
   * we open an SSE stream that emits `started`, repeated `delta`
   * events (one per chunk from the LLM), and finally `completed` or
   * `error`. The frontend pipes deltas into a typing-animation editor.
   */
  @Post()
  async run(
    @Body() body: StreamGenDto,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      try {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    let aborted = false;
    res.on('close', () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    try {
      const stream = this.streamingGeneration.stream({
        organizationId: body.organizationId,
        workspaceId: body.workspaceId ?? null,
        systemId: body.systemId ?? null,
        prompt: body.prompt,
        outputKind: body.outputKind,
        language: body.language,
        priorContent: body.priorContent,
        actorUserId: user.userId,
      });

      for await (const ev of stream) {
        if (aborted) break;
        res.write(`event: ${ev.type}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (err) {
      res.write('event: error\n');
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        })}\n\n`,
      );
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
