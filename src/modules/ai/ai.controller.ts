import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { AiService } from './ai.service';
import { ClaudeCodeService } from './claude-code.service';
import { CodexService } from './codex.service';
import { OpenRouterService } from './openrouter.service';
import { AiChatDto } from './dto/chat.dto';
import { CreateAiChangeRequestDto } from './dto/create-ai-change-request.dto';
import { ListAiChangeRequestsDto } from './dto/list-ai-change-requests.dto';
import { RejectAiChangeRequestDto } from './dto/reject-ai-change-request.dto';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly claudeCodeService: ClaudeCodeService,
    private readonly codexService: CodexService,
    private readonly configService: ConfigService,
    private readonly openRouterService: OpenRouterService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Lightweight discovery endpoint so the coworker UI can show which
   * providers are wired up without trying them first.
   */
  @Get('providers')
  async providers() {
    const claude = await this.claudeCodeService.isAvailable();
    const codex = await this.codexService.isAvailable();
    return {
      openrouter: {
        available: Boolean(
          this.configService.get<string>('OPENROUTER_API_KEY'),
        ),
        defaultModel: this.configService.get<string>(
          'OPENROUTER_MODEL',
          'openai/gpt-4o-mini',
        ),
      },
      claudeCode: {
        available: claude.available,
        version: claude.version,
        hint: claude.available
          ? null
          : 'Install `@anthropic-ai/claude-code` globally and run `claude login` on the backend host.',
        models: ['claude-code:sonnet', 'claude-code:opus', 'claude-code:haiku'],
      },
      codex: {
        available: codex.available,
        version: codex.version,
        hint: codex.available
          ? null
          : 'Install Codex CLI and run `codex login` on the backend host.',
        models: ['codex', 'codex:gpt-5.5', 'codex:gpt-5'],
      },
    };
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'manage_ai',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId' },
    systemId: { source: 'body', key: 'systemId', optional: true },
  })
  @Post('requests')
  create(
    @Body() payload: CreateAiChangeRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiService.createRequest(payload, user.userId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'read',
    organizationId: { source: 'query', key: 'organizationId', optional: true },
    workspaceId: { source: 'query', key: 'workspaceId', optional: true },
    systemId: { source: 'query', key: 'systemId', optional: true },
    allowUnscoped: true,
  })
  @Get('requests')
  findAll(
    @Query() query: ListAiChangeRequestsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiService.findAll(query, user.userId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'read',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Get('requests/:requestId')
  findOne(@Param('requestId') requestId: string) {
    return this.aiService.findOne(requestId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'read',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Get('requests/:requestId/artifacts')
  findArtifacts(@Param('requestId') requestId: string) {
    return this.aiService.findArtifacts(requestId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'read',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Get('requests/:requestId/diff')
  diff(@Param('requestId') requestId: string) {
    return this.aiService.computeDiff(requestId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'read',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Get('requests/:requestId/impact')
  impact(@Param('requestId') requestId: string) {
    return this.aiService.computeImpact(requestId);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'apply_ai',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Post('requests/:requestId/apply')
  apply(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtUser,
    @Body() body?: { selection?: { changeIds?: string[] } },
  ) {
    return this.aiService.applyRequest(
      requestId,
      user.userId,
      body?.selection ?? null,
    );
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'apply_ai',
    resourceId: { source: 'param', key: 'requestId' },
  })
  @Post('requests/:requestId/reject')
  reject(
    @Param('requestId') requestId: string,
    @Body() payload: RejectAiChangeRequestDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.aiService.rejectRequest(requestId, user.userId, payload.reason);
  }

  @RequireAccess({
    resource: 'ai_change_request',
    action: 'manage_ai',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
  })
  @Post('chat')
  async chat(@Body() payload: AiChatDto) {
    const org = await this.organizationsService.findById(
      payload.organizationId,
    );
    const answer = await this.openRouterService.complete(
      [
        {
          role: 'system',
          content:
            'You are Stack62, an assistant for building business systems, coworker jobs, schedules, and workflows. Answer clearly and concisely. If the user is asking for advice, explain directly. Do not create artifacts unless asked.',
        },
        {
          role: 'user',
          content: payload.prompt,
        },
      ],
      org?.openrouterApiKey ?? null,
      payload.model ?? org?.preferredModel ?? null,
    );

    return { answer };
  }
}
