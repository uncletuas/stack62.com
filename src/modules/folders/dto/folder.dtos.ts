import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import type {
  FolderAclSubjectType,
  FolderPermission,
} from '../entities/folder-acl.entity';

export class CreateFolderDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isPersonal?: boolean;
}

export class RenameFolderDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

export class GrantFolderAccessDto {
  @IsIn(['user', 'role', 'org_everyone', 'workspace_everyone'])
  subjectType!: FolderAclSubjectType;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsIn(['read', 'comment', 'write', 'share', 'admin'])
  permission!: FolderPermission;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
