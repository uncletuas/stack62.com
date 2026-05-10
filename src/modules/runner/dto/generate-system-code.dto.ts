import { IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateSystemCodeDto {
  @IsUUID()
  systemId!: string;

  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  model?: string;
}
