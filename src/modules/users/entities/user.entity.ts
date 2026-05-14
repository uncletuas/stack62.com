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

  @Column({ length: 30, default: 'active' })
  status!: string;

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
