import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListBackgroundJobsDto {
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
  queueName?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
