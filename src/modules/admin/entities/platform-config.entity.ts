import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type PlatformConfigCategory =
  | 'general'
  | 'url'
  | 'feature_flag'
  | 'smtp'
  | 'storage'
  | 'payment'
  | 'ai_provider';

/**
 * A single versioned platform configuration value managed from the URL &
 * Configuration Center. `version` is bumped on every change and the prior
 * value is retained in `previousValue` for a one-step rollback. Secret
 * values are masked in API responses (see AdminConfigService).
 */
@Entity({ name: 'platform_configs' })
export class PlatformConfigEntity extends AppBaseEntity {
  @Index({ unique: true })
  @Column({ length: 160 })
  key!: string;

  @Column({ type: 'text', nullable: true })
  value!: string | null;

  @Column({ name: 'previous_value', type: 'text', nullable: true })
  previousValue!: string | null;

  @Column({ length: 30, default: 'general' })
  category!: PlatformConfigCategory;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Secrets are masked in responses and require elevated roles to read. */
  @Column({ name: 'is_secret', default: false })
  isSecret!: boolean;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;
}
