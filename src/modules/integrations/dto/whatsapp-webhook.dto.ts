import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class WhatsAppWebhookQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  providerKey?: string;
}

export class WhatsAppDraftReplyDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  from!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class SelectWhatsAppPhoneNumberDto {
  @IsString()
  phoneNumberId!: string;

  @IsOptional()
  @IsString()
  displayPhoneNumber?: string;

  @IsOptional()
  @IsString()
  verifiedName?: string;

  @IsOptional()
  @IsString()
  businessAccountId?: string;
}
