import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListJobsDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsIn([
    'pending',
    'scheduled',
    'running',
    'completed',
    'failed',
    'paused',
    'cancelled',
  ])
  status?: string;
}
