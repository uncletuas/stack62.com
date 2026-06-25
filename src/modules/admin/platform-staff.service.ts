import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { SecretEncryptionService } from '../../shared/crypto/secret-encryption.service';
import { PlatformStaffEntity } from './entities/platform-staff.entity';
import { PlatformRole } from './platform-staff.constants';

export interface CreateStaffInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
  allowedIps?: string[] | null;
  mustResetPassword?: boolean;
  createdByStaffId?: string | null;
}

/** A staff record with secrets stripped — safe to return over the API. */
export type SanitizedStaff = Omit<
  PlatformStaffEntity,
  'passwordHash' | 'twoFactorSecret'
> & { twoFactorEnabled: boolean };

@Injectable()
export class PlatformStaffService {
  constructor(
    @InjectRepository(PlatformStaffEntity)
    private readonly staffRepository: Repository<PlatformStaffEntity>,
    private readonly secretEncryption: SecretEncryptionService,
  ) {}

  async create(input: CreateStaffInput): Promise<PlatformStaffEntity> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.staffRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('A staff account with this email exists.');
    }
    const staff = this.staffRepository.create({
      email,
      passwordHash: await argon2.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: 'active',
      allowedIps: input.allowedIps ?? null,
      mustResetPassword: input.mustResetPassword ?? true,
      createdByStaffId: input.createdByStaffId ?? null,
    });
    return this.staffRepository.save(staff);
  }

  findById(id: string): Promise<PlatformStaffEntity | null> {
    return this.staffRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<PlatformStaffEntity | null> {
    return this.staffRepository.findOne({
      where: { email: email.trim().toLowerCase() },
    });
  }

  async getByIdOrThrow(id: string): Promise<PlatformStaffEntity> {
    const staff = await this.findById(id);
    if (!staff) throw new NotFoundException('Staff account not found.');
    return staff;
  }

  list(): Promise<PlatformStaffEntity[]> {
    return this.staffRepository.find({ order: { createdAt: 'DESC' } });
  }

  count(): Promise<number> {
    return this.staffRepository.count();
  }

  async verifyPassword(
    staff: PlatformStaffEntity,
    password: string,
  ): Promise<boolean> {
    return argon2.verify(staff.passwordHash, password).catch(() => false);
  }

  async setStatus(
    id: string,
    status: 'active' | 'suspended',
  ): Promise<PlatformStaffEntity> {
    const staff = await this.getByIdOrThrow(id);
    staff.status = status;
    return this.staffRepository.save(staff);
  }

  async setRole(id: string, role: PlatformRole): Promise<PlatformStaffEntity> {
    const staff = await this.getByIdOrThrow(id);
    staff.role = role;
    return this.staffRepository.save(staff);
  }

  async forcePasswordReset(id: string): Promise<PlatformStaffEntity> {
    const staff = await this.getByIdOrThrow(id);
    staff.mustResetPassword = true;
    return this.staffRepository.save(staff);
  }

  /** Wipe 2FA so the staff member is forced to re-enrol on next login. */
  async resetTwoFactor(id: string): Promise<PlatformStaffEntity> {
    const staff = await this.getByIdOrThrow(id);
    staff.twoFactorSecret = null;
    staff.twoFactorEnabledAt = null;
    return this.staffRepository.save(staff);
  }

  async setPassword(
    id: string,
    newPassword: string,
  ): Promise<PlatformStaffEntity> {
    if (!newPassword || newPassword.length < 12) {
      throw new BadRequestException(
        'Password must be at least 12 characters.',
      );
    }
    const staff = await this.getByIdOrThrow(id);
    staff.passwordHash = await argon2.hash(newPassword);
    staff.mustResetPassword = false;
    return this.staffRepository.save(staff);
  }

  // ── 2FA secret storage (encrypted at rest) ──────────────────────────────

  async storePendingTwoFactorSecret(
    id: string,
    plaintextSecret: string,
  ): Promise<void> {
    const staff = await this.getByIdOrThrow(id);
    staff.twoFactorSecret = this.secretEncryption.encrypt(plaintextSecret);
    // enabled_at stays null until first successful verify
    await this.staffRepository.save(staff);
  }

  getDecryptedTwoFactorSecret(staff: PlatformStaffEntity): string | null {
    if (!staff.twoFactorSecret) return null;
    return this.secretEncryption.decrypt(staff.twoFactorSecret);
  }

  async markTwoFactorEnabled(id: string): Promise<void> {
    await this.staffRepository.update(
      { id },
      { twoFactorEnabledAt: new Date() },
    );
  }

  async recordLogin(id: string): Promise<void> {
    await this.staffRepository.update({ id }, { lastLoginAt: new Date() });
  }

  sanitize(staff: PlatformStaffEntity): SanitizedStaff {
    const { passwordHash, twoFactorSecret, ...rest } = staff;
    return { ...rest, twoFactorEnabled: Boolean(staff.twoFactorEnabledAt) };
  }
}
