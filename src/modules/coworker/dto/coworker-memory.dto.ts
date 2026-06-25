import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type {
  CoworkerMemoryKind,
  CoworkerMemorySource,
} from '../entities/coworker-memory.entity';

const KINDS: CoworkerMemoryKind[] = ['fact', 'preference', 'episode'];
const SOURCES: CoworkerMemorySource[] = ['user', 'coworker'];

export class CreateCoworkerMemoryDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsIn(KINDS)
  kind?: CoworkerMemoryKind;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  key?: string;

  @IsString()
  @Length(1, 4000)
  text!: string;

  @IsOptional()
  @IsIn(SOURCES)
  source?: CoworkerMemorySource;
}

export class UpdateCoworkerMemoryDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: CoworkerMemoryKind;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  key?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  text?: string;
}

export class ListCoworkerMemoriesDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsIn(KINDS)
  kind?: CoworkerMemoryKind;
}
