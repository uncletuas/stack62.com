import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export type GoogleAuthIntent =
  | 'signin'
  | 'signup_individual'
  | 'signup_organization';

export class GoogleStartDto {
  @IsOptional()
  @IsIn(['signin', 'signup_individual', 'signup_organization'])
  intent?: GoogleAuthIntent;

  @IsOptional()
  @IsString()
  redirectAfter?: string;

  @IsOptional()
  @IsString()
  inviteToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  organizationRole?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  organizationTeamSize?: number;
}
