import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateRecordDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  systemId!: string;

  @IsUUID()
  moduleDefinitionId!: string;

  @IsUUID()
  entityDefinitionId!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
