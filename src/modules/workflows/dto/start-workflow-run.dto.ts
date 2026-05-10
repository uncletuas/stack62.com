import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class StartWorkflowRunDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  systemId!: string;

  @IsUUID()
  workflowDefinitionId!: string;

  @IsOptional()
  @IsUUID()
  recordId?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
