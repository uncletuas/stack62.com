import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDashboardConfigDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsArray()
  widgets?: Array<Record<string, unknown>>;
}
