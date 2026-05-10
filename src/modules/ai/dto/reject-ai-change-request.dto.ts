import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectAiChangeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
