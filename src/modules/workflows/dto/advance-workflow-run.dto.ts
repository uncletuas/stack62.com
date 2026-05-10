import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { WorkflowRunAction } from '../workflow-runtime.util';

export class AdvanceWorkflowRunDto {
  @IsIn(['advance', 'approve', 'reject', 'complete', 'cancel', 'fail'])
  action!: WorkflowRunAction;

  @IsOptional()
  @IsString()
  nextStepKey?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
