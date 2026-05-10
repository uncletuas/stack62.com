import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'datetime',
  'email',
  'phone',
  'url',
  'textarea',
  'select',
  'relation',
] as const;

export class CreateRecordFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  key?: string;

  @IsOptional()
  @IsIn(FIELD_TYPES)
  dataType?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class CreateRecordCollectionDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  key?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRecordFieldDto)
  fields?: CreateRecordFieldDto[];
}

export class ListRecordCollectionsDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateRecordItemDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateRecordItemDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
