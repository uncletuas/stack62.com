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
}
