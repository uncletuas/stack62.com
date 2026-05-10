import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class WriteSourceFileDto {
  @ApiProperty({
    description: 'Relative path inside the deployment source dir.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  path!: string;

  @ApiProperty({ description: 'Full new file contents (UTF-8, ≤ 512KB).' })
  @IsString()
  @MaxLength(512 * 1024)
  content!: string;
}
