import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListRecordsDto {
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
  @IsUUID()
  entityDefinitionId?: string;

  @IsOptional()
  @IsUUID()
  moduleDefinitionId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
