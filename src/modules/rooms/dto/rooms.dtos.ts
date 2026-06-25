import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RoomKind } from '../entities/room.entity';

export class CreateRoomDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsIn(['channel', 'group', 'dm', 'coworker_private'])
  kind!: RoomKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topic?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  memberUserIds?: string[];

  @IsOptional()
  @IsBoolean()
  coworkerEnabled?: boolean;
}

export class PostMessageDto {
  // Body may be empty when the message carries attachments (e.g. a shared
  // file with no caption). The service enforces "body OR attachments".
  @IsString()
  @MaxLength(40000)
  body!: string;

  @IsOptional()
  @IsUUID()
  parentMessageId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  mentions?: string[];

  @IsOptional()
  @IsArray()
  attachments?: Array<{
    kind: 'file' | 'record' | 'tool_call' | 'plan';
    id: string;
    label?: string;
    extra?: Record<string, unknown>;
  }>;
}
