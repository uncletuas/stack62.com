import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Options,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import {
  WidgetService,
  type CreateWidgetTokenInput,
  type WidgetChatTurn,
} from './widget.service';
import { widgetLoaderScript } from './widget-loader';

@ApiTags('widget')
@Controller('widget')
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  // ── Admin (JWT) ──────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Post('tokens')
  createToken(
    @Body() body: CreateWidgetTokenInput,
    @CurrentUser() user: JwtUser,
  ) {
    return this.widget.createToken(body, user.userId);
  }

  @ApiBearerAuth()
  @Get('tokens')
  listTokens(
    @Query('organizationId') organizationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.widget.listTokens(organizationId, user.userId);
  }

  @ApiBearerAuth()
  @Patch('tokens/:id')
  updateToken(
    @Param('id') id: string,
    @Body() body: Partial<CreateWidgetTokenInput>,
    @CurrentUser() user: JwtUser,
  ) {
    return this.widget.updateToken(id, body, user.userId);
  }

  @ApiBearerAuth()
  @Delete('tokens/:id')
  revokeToken(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.widget.revokeToken(id, user.userId);
  }

  // ── Public (token-authenticated, embeddable) ─────────────────────────────

  @Public()
  @Get('loader.js')
  loader(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(widgetLoaderScript());
  }

  @Public()
  @Options('chat')
  chatPreflight(@Req() req: Request, @Res() res: Response) {
    this.applyCors(req, res);
    res.status(204).send();
  }

  @Public()
  @Options('config')
  configPreflight(@Req() req: Request, @Res() res: Response) {
    this.applyCors(req, res);
    res.status(204).send();
  }

  @Public()
  @Get('config')
  async config(
    @Headers('x-widget-token') headerToken: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = await this.widget.verifyToken(headerToken);
    this.applyCors(req, res);
    if (!token) {
      res.status(401).json({ error: 'Invalid widget token.' });
      return;
    }
    res.json({ greeting: token.greeting, label: token.label });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('chat')
  async chat(
    @Headers('x-widget-token') headerToken: string,
    @Body() body: { message?: string; history?: WidgetChatTurn[] },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const token = await this.widget.verifyToken(headerToken);
    this.applyCors(req, res);
    if (!token) {
      res.status(401).json({ error: 'Invalid or expired widget token.' });
      return;
    }
    const origin = req.headers.origin;
    if (!this.widget.isOriginAllowed(token, origin)) {
      res.status(403).json({ error: 'Origin not allowed for this widget.' });
      return;
    }
    const message = (body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }
    try {
      const reply = await this.widget.answer(
        token,
        message,
        Array.isArray(body?.history) ? body.history : [],
      );
      res.json({ reply });
    } catch {
      res
        .status(500)
        .json({ reply: 'Sorry, something went wrong. Please try again.' });
    }
  }

  /** Reflect an allowed origin back for CORS on the public widget endpoints. */
  private applyCors(req: Request, res: Response) {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,x-widget-token',
    );
  }
}
