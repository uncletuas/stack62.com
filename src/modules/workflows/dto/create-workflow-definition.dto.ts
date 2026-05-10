import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateWorkflowDefinitionDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  systemId!: string;

  @IsOptional()
  @IsUUID()
  systemVersionId?: string;

  @IsOptional()
  @IsUUID()
  moduleDefinitionId?: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  @IsIn([
    'record_created',
    'record_updated',
    'record_deleted',
    'status_changed',
    'schedule',
    'manual',
    'approval_requested',
  ])
  triggerType!: string;

  @IsObject()
  definition!: Record<string, unknown>;
}
