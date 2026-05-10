import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class StartCheckoutDto {
  @IsString()
  organizationId!: string;

  @IsIn(['free', 'starter', 'pro', 'business', 'enterprise'])
  targetTier!: 'free' | 'starter' | 'pro' | 'business' | 'enterprise';

  @IsOptional()
  @IsIn(['monthly', 'yearly'])
  interval?: 'monthly' | 'yearly';

  @IsOptional()
  @IsInt()
  @Min(1)
  seats?: number;
}
