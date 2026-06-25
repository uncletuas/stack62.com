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
  Min,
  ValidateNested,
} from 'class-validator';

class BusinessHoursDto {
  @IsString()
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

export class UpdateEmailAgentDto {
  @IsString()
  organizationId!: string;

  @IsString()
  workspaceId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSend?: boolean;

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
  tone?: string;

  @IsOptional()
  @IsString()
  identityName?: string;

  @IsOptional()
  @IsString()
  identityRole?: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  businessInfo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxAutoRepliesPerDay?: number;
}
