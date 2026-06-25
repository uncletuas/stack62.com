import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'users' })
export class UserEntity extends AppBaseEntity {
  @Index({ unique: true })
  @Column({ length: 255 })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ name: 'first_name', length: 120 })
  firstName!: string;

  @Column({ name: 'last_name', length: 120 })
  lastName!: string;

  /**
   * Profile photo, stored as a reference to a row in `files` with
   * scope='avatar'. Nullable — many users will never upload one and
   * we fall back to initials in the UI.
   */
  @Column({ name: 'avatar_file_id', type: 'uuid', nullable: true })
  avatarFileId!: string | null;

  @Column({ length: 30, default: 'active' })
  status!: string;

  // ── Geography (best-effort, captured at signup for analytics) ─────────
  /** ISO 3166-1 alpha-2 country code, resolved from the signup IP. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  country!: string | null;

  @Column({ name: 'signup_ip', type: 'varchar', length: 45, nullable: true })
  signupIp!: string | null;

  // ── Email verification ────────────────────────────────────────────
  // Verified email = user clicked the link in their welcome email.
  // Until verified we still allow sign-in (so we don't lock anyone
  // out) but the org owner UI shows a "verify your email" banner.
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  emailVerificationToken!: string | null;

  @Column({
    name: 'email_verification_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  emailVerificationExpiresAt!: Date | null;

  // ── Password reset ────────────────────────────────────────────────
  @Column({
    name: 'password_reset_token',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  passwordResetToken!: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  passwordResetExpiresAt!: Date | null;
}
