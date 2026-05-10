import { IsOptional, IsString, IsUUID } from 'class-validator';
import type { WorkflowRunStatus } from '../entities/workflow-run.entity';

export class ListWorkflowRunsDto {
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
  workflowDefinitionId?: string;

  @IsOptional()
  @IsUUID()
  recordId?: string;

  @IsOptional()
  @IsString()
  status?: WorkflowRunStatus;
}
