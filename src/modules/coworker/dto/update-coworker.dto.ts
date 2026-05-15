import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
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

  /**
   * Switch the Coworker into autonomous mode: it acts on its own
   * scheduled tasks without per-action approval. Combined with
   * autonomousMaxActionLevel to keep sensitive actions gated.
   */
  @IsOptional()
  @IsBoolean()
  autonomousMode?: boolean;

  /**
   * Highest action-level the Coworker may take without approval
   * while autonomousMode is on. 1 = read; 2 = write (default);
   * 3 = communicate externally; 4 = irreversible (e.g. payments).
   * Anything above this threshold still spawns an AI change request
   * waiting for human approval.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  autonomousMaxActionLevel?: number;

  @IsOptional()
  @IsObject()
  permissions?: Record<string, boolean>;

  @IsOptional()
  @IsIn(COWORKER_ROLES)
  role?: CoworkerRole;
}
