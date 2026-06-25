import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Invite several teammates at once with a single role. Used by the
 * Team tab's "invite the whole team" flow — paste a list of emails,
 * pick a role, send. Each email is processed independently so one bad
 * address doesn't sink the batch.
 */
export class BulkInviteMembersDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsEmail({}, { each: true })
  emails!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;
}
