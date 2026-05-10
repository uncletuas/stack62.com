import {
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  IsUUID,
} from 'class-validator';

export class CreateViewConfigDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  type!: string;

  @IsOptional()
  @IsUUID()
  entityDefinitionId?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
