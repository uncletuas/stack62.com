import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { SlackBridgeService } from './slack-bridge.service';
import { SlackEventsService } from './slack-events.service';
import { SlackOAuthService } from './slack-oauth.service';

@ApiTags('slack')
@Controller('slack')
export class SlackController {
  constructor(
    private readonly oauthService: SlackOAuthService,
    private readonly bridgeService: SlackBridgeService,
    private readonly eventsService: SlackEventsService,
  ) {}

  // ── Install flow ─────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Get('available')
  available() {
    return { available: this.oauthService.isConfigured() };
  }

  @ApiBearerAuth()
  @Post('install/url')
  installUrl(
    @Body() body: { organizationId: string },
    @CurrentUser() user: JwtUser,
  ) {
    return {
      url: this.oauthService.buildInstallUrl({
        organizationId: body.organizationId,
        actorUserId: user.userId,
      }),
    };
  }

  @Public()
  @Get('install/callback')
  async installCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      return res.redirect(
        `/app?slack_install_error=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return res.redirect(`/app?slack_install_error=missing_code`);
    }
    try {
      const { installation, appUrl } =
        await this.oauthService.handleCallback(code, state);
      return res.redirect(
        `${appUrl}/app?slack_installed=${encodeURIComponent(installation.teamName || installation.teamId)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      return res.redirect(`/app?slack_install_error=${encodeURIComponent(msg)}`);
    }
  }

  @ApiBearerAuth()
  @Get('status')
  async status(@Query('organizationId') organizationId: string) {
    const installation =
      await this.oauthService.findByOrganization(organizationId);
    if (!installation) return { connected: false };
    return {
      connected: true,
      teamId: installation.teamId,
      teamName: installation.teamName,
      installedAt: installation.createdAt,
    };
  }

  // ── Channel mappings ─────────────────────────────────────────────────

  @ApiBearerAuth()
  @Get('channels')
  channels(@Query('organizationId') organizationId: string) {
    return this.bridgeService.listSlackChannels(organizationId);
  }

  @ApiBearerAuth()
  @Get('mappings')
  mappings(@Query('organizationId') organizationId: string) {
    return this.bridgeService.listMappings(organizationId);
  }

  @ApiBearerAuth()
  @Post('mappings')
  createMapping(
    @Body()
    body: {
      organizationId: string;
      roomId: string;
      slackChannelId: string;
      slackChannelName?: string;
      direction?: 'bidirectional' | 'slack_to_stack62' | 'stack62_to_slack';
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.bridgeService.createMapping(body, user.userId);
  }

  @ApiBearerAuth()
  @Delete('mappings/:id')
  deleteMapping(@Param('id') id: string) {
    return this.bridgeService.deleteMapping(id).then(() => ({ ok: true }));
  }

  // ── Events webhook (signed) ──────────────────────────────────────────

  /**
   * Slack POSTs every event here. We need the raw body to verify the
   * signature; main.ts is configured to capture it on `request.rawBody`.
   */
  @Public()
  @Post('events')
  @HttpCode(200)
  async events(
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) {
      throw new BadRequestException(
        'Raw request body unavailable for signature verification.',
      );
    }
    this.eventsService.verifySignature(raw, timestamp, signature);
    return this.eventsService.handlePayload(body);
  }
}
