import {
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class InitializePaymentDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsEmail()
  email!: string;

  @IsInt()
  @Min(100)
  amountKobo!: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  reference?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
