import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AdminChallengeDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;
}

export class AdminVerifyTwoFactorDto {
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits.' })
  code!: string;
}

export class AdminSetPasswordDto {
  @IsString()
  @Length(12, 200, { message: 'Password must be at least 12 characters.' })
  newPassword!: string;
}
