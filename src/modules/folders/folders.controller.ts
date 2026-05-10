import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import {
  CreateFolderDto,
  GrantFolderAccessDto,
  RenameFolderDto,
} from './dto/folder.dtos';
import { FoldersService } from './folders.service';

@ApiTags('folders')
@ApiBearerAuth()
@Controller('folders')
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Post()
  create(@Body() body: CreateFolderDto, @CurrentUser() user: JwtUser) {
    return this.foldersService.createFolder(body, user.userId);
  }

  /**
   * List children of a folder. Pass `parentId` to drill in, or omit to
   * list the org root.
   */
  @Get()
  list(
    @Query('organizationId') organizationId: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('parentId') parentId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.foldersService.listChildren(
      parentId ?? null,
      organizationId,
      workspaceId ?? null,
      user.userId,
    );
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.foldersService.getFolder(id, user.userId);
  }

  @Get(':id/breadcrumbs')
  async breadcrumbs(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    await this.foldersService.getFolder(id, user.userId);
    return this.foldersService.listAncestors(id);
  }

  @Patch(':id')
  rename(
    @Param('id') id: string,
    @Body() body: RenameFolderDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.foldersService.renameFolder(id, body.name, user.userId);
  }

  @Get(':id/acls')
  acls(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.foldersService.listAcls(id, user.userId);
  }

  @Post(':id/acls')
  grant(
    @Param('id') id: string,
    @Body() body: GrantFolderAccessDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.foldersService.grantAccess(
      {
        folderId: id,
        subjectType: body.subjectType,
        userId: body.userId,
        role: body.role,
        permission: body.permission,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      user.userId,
    );
  }

  @Delete('acls/:aclId')
  revoke(@Param('aclId') aclId: string, @CurrentUser() user: JwtUser) {
    return this.foldersService.revokeAccess(aclId, user.userId);
  }
}
