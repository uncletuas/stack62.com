import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import type {
  WorkspaceActionInput,
  WorkspaceDocKind,
} from '../../shared/workspace-actions';
import { WorkspaceExportService } from './workspace-export.service';
import { WorkspaceImportService } from './workspace-import.service';
import { WorkspaceStateService } from './workspace-state.service';

/**
 * REST surface for the AI-native workspace state.
 *
 * Two patterns:
 *  - `POST /workspace/docs/:docId/actions`  — apply a typed action.
 *    Used by the engine `office.dispatch_action` tool and (after
 *    phase 2) for any non-realtime client.
 *  - `GET /workspace/docs/:docId/state`     — read current state.
 *    Snapshots only; for live updates the Hocuspocus channel will
 *    be the canonical path.
 *
 * Realtime Yjs sync goes over websocket (phase 2). This REST
 * surface stays the durable, AI-friendly entry point and the way
 * we test the action pipeline before the websocket is up.
 */
@ApiTags('workspace-state')
@ApiBearerAuth()
@Controller('workspace/docs')
export class WorkspaceStateController {
  constructor(
    private readonly service: WorkspaceStateService,
    private readonly importer: WorkspaceImportService,
    private readonly exporter: WorkspaceExportService,
  ) {}

  @Get()
  async list(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('kind') kind: WorkspaceDocKind | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.list(organizationId, user.userId, {
      workspaceId,
      kind,
    });
  }

  @Get(':docId')
  async findOne(@Param('docId') docId: string, @CurrentUser() user: JwtUser) {
    return this.service.findById(docId, user.userId);
  }

  @Get(':docId/state')
  async readState(@Param('docId') docId: string, @CurrentUser() user: JwtUser) {
    return this.service.readState(docId, user.userId);
  }

  @Get(':docId/actions')
  async readActions(
    @Param('docId') docId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.readActionLog(
      docId,
      user.userId,
      limit ? parseInt(limit, 10) : 100,
    );
  }

  /**
   * Dispatch a typed action. The :docId in the URL is the target
   * doc (we strip it off the body so the URL is the canonical
   * pointer; for the `workspace.create_doc` verb the docId here
   * just needs to be a placeholder uuid since the doc doesn't
   * exist yet — the service ignores it and creates fresh).
   */
  @Post(':docId/actions')
  async dispatch(
    @Param('docId') docId: string,
    @Body()
    body: {
      organizationId: string;
      workspaceId?: string;
      action: Omit<WorkspaceActionInput, 'docId'>;
    },
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.dispatch(
      { ...body.action, docId } as WorkspaceActionInput,
      {
        organizationId: body.organizationId,
        workspaceId: body.workspaceId ?? null,
        actorUserId: user.userId,
      },
    );
  }

  /**
   * Import a .docx or .xlsx file into a brand-new workspace doc.
   * Detects the kind from the upload's mimetype / extension. Returns
   * the new docId so the caller can open it.
   */
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async importFile(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: { organizationId: string; workspaceId: string; title?: string },
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('file is required.');
    const filename = file.originalname.toLowerCase();
    const title =
      body.title ?? file.originalname.replace(/\.(docx|xlsx|pptx)$/i, '');
    if (filename.endsWith('.docx')) {
      return this.importer.importDocx({
        buffer: file.buffer,
        organizationId: body.organizationId,
        workspaceId: body.workspaceId,
        actorUserId: user.userId,
        title,
      });
    }
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      return this.importer.importXlsx({
        buffer: file.buffer,
        organizationId: body.organizationId,
        workspaceId: body.workspaceId,
        actorUserId: user.userId,
        title,
      });
    }
    if (filename.endsWith('.pptx')) {
      return this.importer.importPptx({
        buffer: file.buffer,
        organizationId: body.organizationId,
        workspaceId: body.workspaceId,
        actorUserId: user.userId,
        title,
      });
    }
    throw new BadRequestException(
      'Supported import formats: .docx, .xlsx. Got: ' + file.originalname,
    );
  }

  /**
   * Export a workspace doc back to .docx / .xlsx / .pptx. Streams
   * the binary as an attachment so the browser downloads it. The
   * exported file is NOT registered as a FileEntity — it's a
   * point-in-time snapshot the user is consuming themselves.
   * (`office.export_workspace_doc` engine tool does register the
   * file when the AI initiates an export.)
   */
  @Get(':docId/export')
  async exportFile(
    @Param('docId') docId: string,
    @Query('format') format: string,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') {
      throw new BadRequestException('format must be one of: docx, xlsx, pptx.');
    }
    const out = await this.exporter.export(docId, user.userId, format);
    res.setHeader('Content-Type', out.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(out.filename)}"`,
    );
    res.setHeader('Content-Length', String(out.buffer.length));
    res.end(out.buffer);
  }
}
