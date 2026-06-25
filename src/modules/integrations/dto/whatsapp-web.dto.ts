import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Start (or restart) linking a phone number as a WhatsApp companion device.
 * The phone number must include the country code; non-digits are stripped
 * server-side, so "+234 803 …" and "234803…" are both accepted.
 */
export class StartWhatsAppWebLinkDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  /** Re-pair an existing link instead of creating a new connection. */
  @IsOptional()
  @IsUUID()
  connectionId?: string;
}
