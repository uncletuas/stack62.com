import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class GoogleOAuthUrlDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class GoogleOAuthCallbackDto {
  @IsString()
  @MinLength(4)
  code!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class MetaOAuthUrlDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class MetaOAuthCallbackDto {
  @IsString()
  @MinLength(4)
  code!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class QuickBooksOAuthUrlDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class QuickBooksOAuthCallbackDto {
  @IsString()
  @MinLength(4)
  code!: string;

  @IsString()
  state!: string;

  @IsOptional()
  @IsString()
  realmId?: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class GmailSearchDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  @MinLength(1)
  q!: string;
}

export class GmailDraftDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsArray()
  @IsString({ each: true })
  to!: string[];

  @IsString()
  subject!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  threadId?: string;
}

export class GmailSendDto extends GmailDraftDto {
  @IsBoolean()
  confirmed!: boolean;
}

export class GoogleCalendarEventDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  summary!: string;

  @IsString()
  start!: string;

  @IsString()
  end!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attendees?: string[];

  @IsOptional()
  @IsBoolean()
  createMeetLink?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class GoogleOpenWorkspaceItemDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsString()
  kind!: 'document' | 'spreadsheet' | 'presentation' | 'text';

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  sourceType?: 'document' | 'file';
}
