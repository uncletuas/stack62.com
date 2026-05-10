import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class AiChatDto {
  @IsUUID()
  organizationId: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
