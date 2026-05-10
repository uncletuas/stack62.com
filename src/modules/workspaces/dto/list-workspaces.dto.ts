import { IsOptional, IsUUID } from 'class-validator';

export class ListWorkspacesDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
