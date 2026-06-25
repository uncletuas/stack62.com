import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * Runtime-editable configuration. Lets staff change variables (API keys,
 * feature flags, amounts) WITHOUT a code change or redeploy: SettingsService
 * overlays these rows on top of the env-backed ConfigService. Secret values
 * (`isSecret=true`) are stored encrypted via SecretEncryptionService and never
 * returned in plaintext to the UI.
 */
@Entity({ name: 'platform_settings' })
export class PlatformSettingEntity extends AppBaseEntity {
  @Index({ unique: true })
  @Column({ length: 160 })
  key!: string;

  /** Encrypted when isSecret; plaintext otherwise. */
  @Column({ type: 'text', nullable: true })
  value!: string | null;

  @Column({ length: 60, default: 'general' })
  category!: string;

  @Column({ name: 'is_secret', type: 'boolean', default: false })
  isSecret!: boolean;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'updated_by_staff_id', type: 'uuid', nullable: true })
  updatedByStaffId!: string | null;
}
