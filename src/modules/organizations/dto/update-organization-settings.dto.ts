import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional({
    description: 'OpenRouter API key for BYOK (bring your own key)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  openrouterApiKey?: string | null;

  @ApiPropertyOptional({
    description: 'Preferred LLM model slug (e.g. openai/gpt-4o)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  preferredModel?: string | null;
}
