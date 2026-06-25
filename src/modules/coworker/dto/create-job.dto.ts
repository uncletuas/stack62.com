import {
  IsBoolean,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateJobDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  instructions!: string;

  @IsOptional()
  @IsIn(['manual', 'schedule', 'event'])
  triggerType?: 'manual' | 'schedule' | 'event';

  @IsOptional()
  @IsObject()
  triggerConfig?: {
    runAt?: string | null;
    rrule?: string | null;
    eventName?: string | null;
  };

  @IsOptional()
  @IsBoolean()
  autopilot?: boolean;
}

export class UpdateJobDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsIn(['manual', 'schedule', 'event'])
  triggerType?: 'manual' | 'schedule' | 'event';

  @IsOptional()
  @IsObject()
  triggerConfig?: {
    runAt?: string | null;
    rrule?: string | null;
    eventName?: string | null;
  };

  @IsOptional()
  @IsBoolean()
  autopilot?: boolean;

  @IsOptional()
  @IsIn([
    'pending',
    'scheduled',
    'running',
    'completed',
    'failed',
    'paused',
    'cancelled',
  ])
  status?:
    | 'pending'
    | 'scheduled'
    | 'running'
    | 'completed'
    | 'failed'
    | 'paused'
    | 'cancelled';
}

export class CreateWeeklyReportJobDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsIn(['tasks', 'records', 'activity', 'mixed'])
  sourceType?: 'tasks' | 'records' | 'activity' | 'mixed';

  @IsOptional()
  @IsIn(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
  dayOfWeek?: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  minute?: number;
}

export class CreateReminderJobDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  workspaceId!: string;

  @IsOptional()
  @IsUUID()
  systemId?: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  instructions!: string;

  @IsOptional()
  @IsString()
  runAt?: string;

  @IsOptional()
  @IsString()
  rrule?: string;
}
