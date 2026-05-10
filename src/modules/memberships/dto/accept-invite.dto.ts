import { IsString, MaxLength } from 'class-validator';

export class AcceptInviteDto {
  @IsString()
  @MaxLength(128)
  token!: string;
}
