import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Send a stored file as a WhatsApp media message (image/video/audio/document)
 * through a linked device. The file must already exist in the file store —
 * upload it first, then reference it by id here.
 */
export class SendWhatsAppMediaDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  @MinLength(6)
  to!: string;

  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  caption?: string;

  /** Send audio as a voice note (push-to-talk). */
  @IsOptional()
  @IsBoolean()
  ptt?: boolean;

  /** Force the media kind (e.g. send an image as a 'sticker'). */
  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  forceType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  /** Reply to (quote) an existing stored message. */
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
