import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { FileSharingService } from './file-sharing.service';

class CreateShareDto {
  @IsOptional()
  @IsEmail()
  targetEmail?: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsIn(['read', 'comment', 'write', 'share', 'admin'])
  permission!: 'read' | 'comment' | 'write' | 'share' | 'admin';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsBoolean()
  asPublicLink?: boolean;
}

@ApiTags('file-sharing')
@ApiBearerAuth()
@Controller()
export class FileSharingController {
  constructor(private readonly fileSharing: FileSharingService) {}

  @Post('files/:fileId/shares')
  create(
    @Param('fileId') fileId: string,
    @Body() body: CreateShareDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.fileSharing.createShare({ ...body, fileId }, user.userId);
  }

  @Get('files/:fileId/shares')
  list(@Param('fileId') fileId: string, @CurrentUser() user: JwtUser) {
    return this.fileSharing.listSharesForFile(fileId, user.userId);
  }

  /** Files shared with the current user across all files. */
  @Get('files-shared-with-me')
  sharedWithMe(@CurrentUser() user: JwtUser) {
    return this.fileSharing.listSharedWithMe(user.userId);
  }

  @Delete('file-shares/:id')
  revoke(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.fileSharing.revoke(id, user.userId).then(() => ({ ok: true }));
  }

  /**
   * Public preview of a token share. Returns the file metadata so the
   * recipient sees what they're about to access before logging in.
   */
  @Public()
  @Get('file-shares/lookup/:token')
  lookup(@Param('token') token: string) {
    return this.fileSharing.lookupByToken(token);
  }
}
