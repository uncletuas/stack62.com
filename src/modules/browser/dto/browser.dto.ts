import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BrowserScopeDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class BrowserNavigateDto extends BrowserScopeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;
}

export class BrowserSearchDto extends BrowserScopeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  engine?: string;
}

export class BrowserActionDto extends BrowserScopeDto {
  @IsIn(['click', 'type', 'key', 'scroll', 'back', 'forward', 'reload'])
  type!: 'click' | 'type' | 'key' | 'scroll' | 'back' | 'forward' | 'reload';

  @IsOptional()
  @IsInt()
  x?: number;

  @IsOptional()
  @IsInt()
  y?: number;

  @IsOptional()
  @IsInt()
  deltaY?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;
}
