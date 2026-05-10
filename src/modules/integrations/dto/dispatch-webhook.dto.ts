import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class DispatchWebhookDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}
