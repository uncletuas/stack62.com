import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListSystemsDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'archived'])
  status?: string;
}
