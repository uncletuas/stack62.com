import { IsNotEmpty, IsString } from 'class-validator';

export class LoopitalSsoDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
