import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadFileDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsIn(['attachment', 'document', 'system_asset', 'avatar', 'other'])
  scope?: 'attachment' | 'document' | 'system_asset' | 'avatar' | 'other';

  @IsOptional()
  @IsString()
  ownerKind?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
