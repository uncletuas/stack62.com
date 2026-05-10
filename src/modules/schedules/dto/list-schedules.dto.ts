import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListSchedulesDto {
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
  status?: string;
}
