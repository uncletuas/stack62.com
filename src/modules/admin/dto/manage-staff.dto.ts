import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PLATFORM_ROLES, type PlatformRole } from '../platform-staff.constants';

export class CreateStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(12, 200, { message: 'Password must be at least 12 characters.' })
  password!: string;

  @IsString()
  @Length(1, 120)
  firstName!: string;

  @IsString()
  @Length(1, 120)
  lastName!: string;

  @IsIn(PLATFORM_ROLES)
  role!: PlatformRole;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedIps?: string[];
}

export class UpdateStaffRoleDto {
  @IsIn(PLATFORM_ROLES)
  role!: PlatformRole;
}

export class UpdateStaffStatusDto {
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}
