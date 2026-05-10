import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListPermissionPoliciesDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsString()
  role?: string;
}
