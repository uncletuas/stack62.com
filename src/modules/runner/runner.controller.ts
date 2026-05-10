import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { RequireAccess } from '../../shared/access-control/access-control.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CodeGeneratorService } from './code-generator.service';
import { DeployDto } from './dto/deploy.dto';
import { GenerateSystemCodeDto } from './dto/generate-system-code.dto';
import { RunnerEventsService } from './runner-events.service';
import { RunnerService } from './runner.service';
import { WriteSourceFileDto } from './dto/write-source-file.dto';

@ApiTags('runner')
@ApiBearerAuth()
@Controller('runner')
export class RunnerController {
  constructor(
    private readonly runnerService: RunnerService,
    private readonly codeGeneratorService: CodeGeneratorService,
    private readonly runnerEventsService: RunnerEventsService,
  ) {}

  @Public()
  @Sse('systems/:systemId/events')
  async systemEvents(
    @Param('systemId') systemId: string,
    @Query('token') token: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const actorUserId = this.runnerEventsService.verifyStreamToken(token);
    await this.runnerService.assertSystemReadAccess(systemId, actorUserId);
    return this.runnerEventsService.stream(systemId);
  }

  @Post('generate')
  @RequireAccess({
    resource: 'system',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId' },
  })
  async generate(@Body() payload: GenerateSystemCodeDto) {
    const { codebase, dir } = await this.codeGeneratorService.generate({
      systemId: payload.systemId,
      organizationId: payload.organizationId,
      prompt: payload.prompt,
      model: payload.model,
    });
    return {
      systemId: payload.systemId,
      dir,
      summary: codebase.summary,
      entrypoint: codebase.entrypoint,
      runtime: codebase.runtime,
      fileCount: codebase.files.length,
      files: codebase.files.map((f) => ({
        path: f.path,
        size: f.content.length,
      })),
    };
  }

  @Post('deploy')
  @RequireAccess({
    resource: 'system',
    action: 'update',
    organizationId: { source: 'body', key: 'organizationId' },
    workspaceId: { source: 'body', key: 'workspaceId', optional: true },
    systemId: { source: 'body', key: 'systemId' },
  })
  deploy(@Body() payload: DeployDto, @CurrentUser() user: JwtUser) {
    return this.runnerService.deploy(payload, user.userId);
  }

  @Get('deployments')
  list(
    @Query('systemId') systemId: string | undefined,
    @Query('organizationId') organizationId: string | undefined,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.runnerService.list(
      { systemId, organizationId, workspaceId, status },
      user.userId,
    );
  }

  @Get('deployments/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.runnerService.findOne(id, user.userId);
  }

  @Post('deployments/:id/start')
  start(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.runnerService.start(id, user.userId);
  }

  @Post('deployments/:id/stop')
  stop(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.runnerService.stop(id, user.userId);
  }

  @Get('deployments/:id/logs')
  logs(
    @Param('id') id: string,
    @Query('tail') tail: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.runnerService.logs(id, user.userId, tail ? Number(tail) : 200);
  }

  /**
   * Mint a short-lived token for the /sys/:id proxy. The frontend calls this
   * before opening the preview iframe so the browser doesn't have to carry
   * the user's main access token in a query string.
   */
  @Post('deployments/:id/preview-session')
  previewSession(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.runnerService.mintPreviewToken(id, user.userId);
  }

  @Get('deployments/:id/files')
  files(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.runnerService.listSourceFiles(id, user.userId);
  }

  @Get('deployments/:id/files/content')
  readFile(
    @Param('id') id: string,
    @Query('path') path: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.runnerService.readSourceFile(id, user.userId, path);
  }

  @Put('deployments/:id/files/content')
  writeFile(
    @Param('id') id: string,
    @Body() payload: WriteSourceFileDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.runnerService.writeSourceFile(
      id,
      user.userId,
      payload.path,
      payload.content,
    );
  }
}
