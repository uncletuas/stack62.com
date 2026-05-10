import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CoworkerChatDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  conversationId?: string;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsString()
  systemHint?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsBoolean()
  autopilot?: boolean;
}

export class ListCoworkerMessagesDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  conversationId?: string;
}
