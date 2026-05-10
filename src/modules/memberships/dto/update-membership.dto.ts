import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateMembershipDto {
  @IsOptional()
  @IsString()
  @IsIn(['owner', 'admin', 'member', 'viewer'])
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: string;
}
