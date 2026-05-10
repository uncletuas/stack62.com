import { Type } from 'class-transformer';
import {
  IsDate,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateScheduleDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  recordId?: string;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  kind!: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
