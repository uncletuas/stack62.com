import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { FilesService } from '../files/files.service';
import { Public } from '../../shared/decorators/public.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly filesService: FilesService,
  ) {}

  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return users.map((user) => this.usersService.sanitize(user));
  }

  @Get('me')
  async getCurrentUser(@CurrentUser() user: JwtUser) {
    const fullUser = await this.usersService.findById(user.userId);
    return this.usersService.sanitize(fullUser);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: JwtUser,
    @Body() body: { firstName?: string; lastName?: string },
  ) {
    const updated = await this.usersService.updateProfile(user.userId, body);
    return this.usersService.sanitize(updated);
  }

  /**
   * Upload (or replace) the current user's profile photo.
   * Goes through FilesService with scope='avatar' so we get the same
   * tenant-aware storage + checksum dedup. The User row is updated to
   * point at the new file.
   *
   * Max 5MB, image/* only — bigger images are usually a user mistake
   * and slow every page that renders the avatar.
   */
  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: JwtUser,
    @Body() body: { organizationId?: string },
  ) {
    if (!file) throw new BadRequestException('file is required.');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'Avatar must be an image (PNG, JPG, WebP, GIF, etc).',
      );
    }
    // We need a tenant context so the file lands in the right org.
    // The auth payload doesn't always carry one — accept it from the
    // body and trust the access-control layer in FilesService to
    // refuse if the actor isn't a member.
    const organizationId = body.organizationId;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required so the avatar can be stored against your org.',
      );
    }
    const stored = await this.filesService.upload(
      {
        organizationId,
        scope: 'avatar',
        ownerKind: 'user',
        ownerId: actor.userId,
      },
      {
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
      actor.userId,
    );
    const updated = await this.usersService.setAvatar(actor.userId, stored.id);
    return this.usersService.sanitize(updated);
  }

  @Delete('me/avatar')
  async clearAvatar(@CurrentUser() actor: JwtUser) {
    const updated = await this.usersService.setAvatar(actor.userId, null);
    return this.usersService.sanitize(updated);
  }

  /**
   * Stream a user's avatar by id so a plain <img src> works without
   * juggling auth tokens. We only resolve to the file the user has
   * explicitly set as their avatar — not an arbitrary file id.
   *
   * Public because avatars are visible across orgs the user shares
   * (think DMs across workspaces). The id is a uuid so it isn't
   * enumerable in practice.
   */
  @Public()
  @Get(':userId/avatar')
  async getAvatar(
    @Param('userId') userId: string,
    @Res() res: Response,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user.avatarFileId) {
      res.status(404).json({ message: 'No avatar set.' });
      return;
    }
    const file = await this.filesService.findOne(user.avatarFileId, user.id);
    const buffer = await this.filesService.getBuffer(file);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
  }
}
