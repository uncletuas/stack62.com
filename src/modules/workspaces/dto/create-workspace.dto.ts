import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
