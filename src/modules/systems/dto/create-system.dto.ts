import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateDashboardConfigDto } from './create-dashboard-config.dto';
import { CreateModuleDefinitionDto } from './create-module-definition.dto';
import { CreateViewConfigDto } from './create-view-config.dto';

export class CreateSystemDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  purpose?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  teamSize?: number;

  @IsOptional()
  @IsString()
  industryType?: string;

  @IsOptional()
  @IsIn(['standard', 'strict'])
  governanceMode?: string;

  @IsOptional()
  @IsIn(['private', 'organization', 'public'])
  visibility?: string;

  @IsOptional()
  @IsString()
  sourcePrompt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateModuleDefinitionDto)
  modules?: CreateModuleDefinitionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateViewConfigDto)
  views?: CreateViewConfigDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDashboardConfigDto)
  dashboards?: CreateDashboardConfigDto[];
}
