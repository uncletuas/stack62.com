import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateSharePackageDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  systemId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['template_only', 'cloned_instance', 'live_shared_workspace'])
  mode!: string;

  @IsString()
  @IsIn(['include_data', 'masked_data', 'exclude_data'])
  dataAccessMode!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
