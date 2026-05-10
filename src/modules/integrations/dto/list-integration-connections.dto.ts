import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListIntegrationConnectionsDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  providerKey?: string;
}
