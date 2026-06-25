import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { BrowserService, BrowserScope } from './browser.service';
import {
  BrowserActionDto,
  BrowserNavigateDto,
  BrowserScopeDto,
  BrowserSearchDto,
} from './dto/browser.dto';
import type { BrowserAction } from './browser-session.service';

@ApiTags('browser')
@ApiBearerAuth()
@Controller('browser')
export class BrowserController {
  constructor(private readonly browser: BrowserService) {}

  private scope(
    dto: { organizationId: string; workspaceId?: string },
    user: JwtUser,
  ): BrowserScope {
    return {
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      userId: user.userId,
    };
  }

  @Post('navigate')
  @RequireAccess({
    resource: 'coworker',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  navigate(@Body() dto: BrowserNavigateDto, @CurrentUser() user: JwtUser) {
    return this.browser.navigate(this.scope(dto, user), dto.url);
  }

  @Post('search')
  @RequireAccess({
    resource: 'coworker',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  search(@Body() dto: BrowserSearchDto, @CurrentUser() user: JwtUser) {
    return this.browser.search(this.scope(dto, user), dto.query, dto.engine);
  }

  @Post('action')
  @RequireAccess({
    resource: 'coworker',
    action: 'read',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  action(@Body() dto: BrowserActionDto, @CurrentUser() user: JwtUser) {
    const { organizationId, workspaceId, ...action } = dto;
    return this.browser.action(
      this.scope(dto, user),
      action as unknown as BrowserAction,
    );
  }

  @Get('content')
  @RequireAccess({
    resource: 'coworker',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId' },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
  })
  content(@Query() dto: BrowserScopeDto, @CurrentUser() user: JwtUser) {
    return this.browser.content(this.scope(dto, user));
  }

  @Get('screenshot')
  @RequireAccess({
    resource: 'coworker',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId' },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
  })
  async screenshot(
    @Query() dto: BrowserScopeDto,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    const png = await this.browser.screenshot(this.scope(dto, user));
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }
}
