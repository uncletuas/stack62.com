import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecretEncryptionService } from '../../../shared/crypto/secret-encryption.service';
import { PlatformSettingEntity } from '../entities/platform-setting.entity';
import {
  SETTINGS_CATALOG,
  SettingDescriptor,
  findDescriptor,
} from './settings.catalog';

export interface SettingView {
  key: string;
  category: string;
  isSecret: boolean;
  description: string | null;
  /** Plaintext for non-secrets; null/masked indicator for secrets. */
  value: string | null;
  isSet: boolean;
  source: 'override' | 'env' | 'unset';
  updatedByStaffId: string | null;
  updatedAt: string | null;
}

/**
 * Runtime configuration overlay. DB rows (platform_settings) win over the
 * env-backed ConfigService, so staff can change variables without a redeploy.
 * Consuming services should call `resolve(key, fallback)` instead of reading
 * ConfigService directly for any value they want to be runtime-editable.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(PlatformSettingEntity)
    private readonly settingsRepo: Repository<PlatformSettingEntity>,
    private readonly configService: ConfigService,
    private readonly secretEncryption: SecretEncryptionService,
  ) {}

  /** DB override → env → fallback. Decrypts secret overrides transparently. */
  async resolve(key: string, fallback?: string): Promise<string | undefined> {
    const row = await this.settingsRepo.findOne({ where: { key } });
    if (row && row.value != null) {
      return row.isSecret
        ? this.secretEncryption.decrypt(row.value)
        : row.value;
    }
    const env = this.configService.get<string>(key);
    return env ?? fallback;
  }

  async resolveBool(key: string, fallback = false): Promise<boolean> {
    const raw = await this.resolve(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    return String(raw).toLowerCase() === 'true';
  }

  /** Catalog + current state, secrets masked. Powers the config UI. */
  async list(): Promise<SettingView[]> {
    const rows = await this.settingsRepo.find();
    const byKey = new Map(rows.map((r) => [r.key, r]));

    // Union of catalog keys and any ad-hoc keys already stored.
    const keys = new Set<string>(SETTINGS_CATALOG.map((d) => d.key));
    for (const r of rows) keys.add(r.key);

    return [...keys]
      .map((key) => this.toView(key, byKey.get(key), findDescriptor(key)))
      .sort((a, b) =>
        a.category === b.category
          ? a.key.localeCompare(b.key)
          : a.category.localeCompare(b.category),
      );
  }

  async upsert(
    key: string,
    value: string,
    staffId: string,
    opts?: { category?: string; isSecret?: boolean; description?: string },
  ): Promise<SettingView> {
    const descriptor = findDescriptor(key);
    const isSecret = opts?.isSecret ?? descriptor?.secret ?? false;
    let row = await this.settingsRepo.findOne({ where: { key } });
    if (!row) {
      row = this.settingsRepo.create({ key });
    }
    row.value = isSecret ? this.secretEncryption.encrypt(value) : value;
    row.isSecret = isSecret;
    row.category = opts?.category ?? descriptor?.category ?? row.category ?? 'general';
    row.description = opts?.description ?? descriptor?.description ?? row.description ?? null;
    row.updatedByStaffId = staffId;
    const saved = await this.settingsRepo.save(row);
    return this.toView(key, saved, descriptor);
  }

  async clear(key: string): Promise<void> {
    await this.settingsRepo.delete({ key });
  }

  private toView(
    key: string,
    row: PlatformSettingEntity | undefined,
    descriptor: SettingDescriptor | undefined,
  ): SettingView {
    const isSecret = row?.isSecret ?? descriptor?.secret ?? false;
    const hasOverride = !!row && row.value != null;
    const envValue = this.configService.get<string>(key);
    const source: SettingView['source'] = hasOverride
      ? 'override'
      : envValue !== undefined && envValue !== ''
        ? 'env'
        : 'unset';

    let value: string | null;
    if (isSecret) {
      // Never leak secrets. Show whether one is set, not the value.
      value = source === 'unset' ? null : '••••••••';
    } else if (hasOverride) {
      value = row!.value;
    } else {
      value = envValue ?? null;
    }

    return {
      key,
      category: row?.category ?? descriptor?.category ?? 'general',
      isSecret,
      description: row?.description ?? descriptor?.description ?? null,
      value,
      isSet: source !== 'unset',
      source,
      updatedByStaffId: row?.updatedByStaffId ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }
}
