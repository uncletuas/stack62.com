import { IsOptional, IsString, IsUUID } from 'class-validator';

export class DeployDto {
  @IsUUID()
  systemId!: string;

  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  entrypoint?: string;

  @IsOptional()
  @IsString()
  runtime?: string;
}
