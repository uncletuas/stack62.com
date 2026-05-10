import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMembershipDto {
  @IsUUID()
  userId!: string;

  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  role!: string;
}
