import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class BusinessHoursDto {
  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @Matches(/^\d{2}:\d{2}$/, { message: 'start must be HH:MM' })
  start!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'end must be HH:MM' })
  end!: string;
}

export class UpdateWhatsAppAgentDto {
  @IsString()
  organizationId!: string;

  @IsString()
  workspaceId!: string;

  @IsOptional()
  @IsBoolean()
  autoReplyEnabled?: boolean;

  @IsOptional()
  @IsIn(['always', 'business_hours', 'after_hours'])
  responseSchedule?: 'always' | 'business_hours' | 'after_hours';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BusinessHoursDto)
  businessHours?: BusinessHoursDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  tone?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  responseDelaySeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  identityName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  identityRole?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  signature?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  businessInfo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  awayMessage?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxAutoRepliesPerDay?: number;
}
