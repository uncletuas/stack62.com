import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export type RegisterAccountType = 'individual' | 'organization';

/**
 * Sign-up payload. Two paths share the endpoint:
 *
 * - `individual` (default): a single user creates a personal account. We
 *   auto-provision a private "Personal" organization and workspace so the
 *   downstream tenancy model still applies, but the user never sees them.
 * - `organization`: the registrant is starting Stack62 for their team.
 *   We capture their role + the org name + an estimated team size to
 *   tailor onboarding (and seed the pricing page suggestion).
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  firstName!: string;

  @IsString()
  @MinLength(2)
  lastName!: string;

  @IsOptional()
  @IsIn(['individual', 'organization'])
  accountType?: RegisterAccountType;

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

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
