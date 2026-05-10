import { IsOptional, IsUUID } from 'class-validator';

export class ListWorkflowDefinitionsDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;
}
