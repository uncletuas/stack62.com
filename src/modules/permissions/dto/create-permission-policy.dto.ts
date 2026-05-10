import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreatePermissionPolicyDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['workspace', 'module', 'record', 'field'])
  scope!: string;

  @IsString()
  role!: string;

  @IsString()
  @IsIn([
    'organization',
    'workspace',
    'system',
    'module',
    'record',
    'field',
    'workflow_definition',
    'permission_policy',
    'share_package',
  ])
  resourceType!: string;

  @IsArray()
  actions!: string[];

  @IsOptional()
  @IsObject()
  fieldRestrictions?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;
}
