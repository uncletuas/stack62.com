import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UploadFileDto } from './dto/upload-file.dto';
import { FilesService } from './files.service';
import type { FileScope } from './entities/file.entity';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.upload(
      body,
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
      user.userId,
    );
  }

  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('systemId') systemId: string | undefined,
    @Query('scope') scope: FileScope | undefined,
    @Query('ownerKind') ownerKind: string | undefined,
    @Query('ownerId') ownerId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.list(organizationId, user.userId, {
      workspaceId,
      systemId,
      scope,
      ownerKind,
      ownerId,
    });
  }

  @Get(':fileId')
  findOne(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.filesService.findOne(fileId, user.userId);
  }

  @Get(':fileId/download')
  async download(
    @Param('fileId') fileId: string,
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
  ) {
    const { file, buffer } = await this.filesService.read(fileId, user.userId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.filename)}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }

  @Get(':fileId/content')
  readContent(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.filesService.readEditableContent(fileId, user.userId);
  }

  @Get(':fileId/versions')
  versions(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.filesService.listVersions(fileId, user.userId);
  }

  @Patch(':fileId/content')
  saveContent(
    @Param('fileId') fileId: string,
    @Body() body: { text?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.saveEditableContent(
      fileId,
      body.text ?? '',
      user.userId,
    );
  }

  @Delete(':fileId')
  delete(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.filesService.delete(fileId, user.userId);
  }

  /**
   * Rename and/or move a file. Body: `{ filename?, folderId? }`. Pass
   * `folderId: null` to move to the org root.
   */
  @Patch(':fileId')
  update(
    @Param('fileId') fileId: string,
    @Body() body: { filename?: string; folderId?: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.update(fileId, user.userId, {
      filename: body.filename,
      folderId: body.folderId,
    });
  }

  @Post(':fileId/copy')
  copy(
    @Param('fileId') fileId: string,
    @Body() body: { folderId?: string | null; filename?: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.copy(fileId, user.userId, {
      folderId: body.folderId,
      filename: body.filename,
    });
  }

  /** Bulk delete. Body: `{ ids: string[] }`. */
  @Post('bulk-delete')
  bulkDelete(
    @Body() body: { ids: string[] },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.deleteMany(body.ids ?? [], user.userId);
  }

  /** Bulk move. Body: `{ ids: string[]; folderId: string | null }`. */
  @Post('bulk-move')
  bulkMove(
    @Body() body: { ids: string[]; folderId: string | null },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.moveMany(
      body.ids ?? [],
      body.folderId ?? null,
      user.userId,
    );
  }

  @Post('signed-upload-url')
  getSignedUploadUrl(
    @Body() body: UploadFileDto & { mimeType: string; filename: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.getSignedUploadUrl(
      body,
      body.mimeType,
      body.filename,
      user.userId,
    );
  }

  @Post('register-direct-upload')
  registerDirectUpload(
    @Body() body: UploadFileDto & { key: string; filename: string; mimeType: string; size: number; checksum: string },
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.registerDirectUpload(
      body,
      body.key,
      body.filename,
      body.mimeType,
      body.size,
      body.checksum,
      user.userId,
    );
  }

  @Get(':fileId/signed-download-url')
  getSignedDownloadUrl(
    @Param('fileId') fileId: string,
    @Query('expiresInSeconds') expiresInSeconds: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.filesService.getSignedDownloadUrl(
      fileId,
      user.userId,
      expiresInSeconds ? Number(expiresInSeconds) : undefined,
    );
  }
}
