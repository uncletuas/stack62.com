import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class PublishSystemVersionDto {
  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(5)
  changeSummary?: string;

  @IsOptional()
  @IsUUID()
  rollbackToVersionId?: string;
}
