import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RollbackSystemVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
