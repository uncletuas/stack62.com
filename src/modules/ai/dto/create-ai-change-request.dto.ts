import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateAiChangeRequestDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @MinLength(10)
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @IsOptional()
  @IsBoolean()
  generateArtifacts?: boolean;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
