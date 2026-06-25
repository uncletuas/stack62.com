import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { EngineService, type EngineEvent } from './engine.service';
import { CoworkerRuntimeService } from './coworker-runtime.service';
import { RunEngineDto } from './dto/run-engine.dto';
import { ToolRegistry } from './tools/registry';

@ApiTags('engine')
@ApiBearerAuth()
@Controller('engine')
export class EngineController {
  constructor(
    private readonly engineService: EngineService,
    private readonly toolRegistry: ToolRegistry,
    private readonly coworkerRuntimeService: CoworkerRuntimeService,
  ) {}

  @Get('tools')
  listTools() {
    return this.toolRegistry.list().map((t) => ({
      name: t.name,
      description: t.spec.description,
      schema: t.spec.input_schema,
      permission: t.permission ?? null,
      actionLevel: t.actionLevel ?? 1,
      requiresConfirmation: t.requiresConfirmation ?? false,
      sensitive: t.sensitive ?? false,
      auditAction: t.auditAction ?? null,
      responseSchema: t.responseSchema ?? null,
    }));
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('operations/:operationId/stop')
  stopOperation(@Param('operationId') operationId: string) {
    return {
      operationId,
      stopped: this.coworkerRuntimeService.stop(operationId),
    };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('run')
  async run(
    @Body() body: RunEngineDto,
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

    const send = (event: EngineEvent) => {
      try {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* client closed */
      }
    };

    let aborted = false;
    res.on('close', () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    try {
      const stream = this.engineService.run({
        ctx: {
          organizationId: body.organizationId,
          workspaceId: body.workspaceId ?? null,
          systemId: body.systemId ?? null,
          actorUserId: user.userId,
          autopilot: body.autopilot,
        },
        prompt: body.prompt,
        history: body.history?.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        systemHint: body.systemHint,
        model: body.model,
        autopilot: body.autopilot,
      });

      for await (const ev of stream) {
        if (aborted) break;
        send(ev);
      }
    } catch (err) {
      send({
        type: 'session.error',
        message: err instanceof Error ? err.message : 'Engine failed.',
      });
    } finally {
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
}
