import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { COWORKER_ROLES, type CoworkerRole } from '../entities/coworker.entity';

export class UpdateCoworkerDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsString()
  voice?: string | null;

  @IsOptional()
  @IsBoolean()
  defaultAutopilot?: boolean;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, boolean>;

  @IsOptional()
  @IsIn(COWORKER_ROLES)
  role?: CoworkerRole;
}
