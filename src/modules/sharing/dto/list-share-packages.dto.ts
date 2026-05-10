import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListSharePackagesDto {
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
  @IsIn(['template_only', 'cloned_instance', 'live_shared_workspace'])
  mode?: string;
}
