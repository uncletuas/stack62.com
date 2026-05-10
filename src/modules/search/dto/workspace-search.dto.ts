import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class WorkspaceSearchDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  @MinLength(1)
  q!: string;
}

export class WorkspaceQuestionDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @MinLength(1)
  question!: string;
}
