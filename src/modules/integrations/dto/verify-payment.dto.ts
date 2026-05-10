import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class VerifyPaymentDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsString()
  @MinLength(3)
  reference!: string;
}
