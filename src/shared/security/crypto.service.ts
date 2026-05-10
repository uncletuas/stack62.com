import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedBlob {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    !!value &&
    typeof value === 'object' &&
    'v' in value &&
    'iv' in value &&
    'ct' in value &&
    'tag' in value &&
    (value as EncryptedBlob).v === 1
  );
}

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const raw =
      configService.get<string>('STACK62_ENCRYPTION_KEY') ||
      configService.get<string>('ENCRYPTION_KEY') ||
      configService.get<string>('JWT_SECRET');
    if (!raw) {
      this.logger.warn(
        'No encryption key configured (STACK62_ENCRYPTION_KEY/ENCRYPTION_KEY). Falling back to a deterministic dev key. Set one in production.',
      );
    }
    this.key = createHash('sha256')
      .update(raw ?? 'stack62-dev-encryption-key')
      .digest();
  }

  encryptJson(value: Record<string, unknown> | null): EncryptedBlob | null {
    if (!value || Object.keys(value).length === 0) return null;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  decryptJson(blob: EncryptedBlob): Record<string, unknown> {
    const iv = Buffer.from(blob.iv, 'base64');
    const ct = Buffer.from(blob.ct, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  }

  /**
   * Returns plaintext credentials whether they were stored as an encrypted blob
   * or in legacy plaintext form. Returns null if the value is masked or empty.
   */
  readCredentials(
    stored: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!stored) return null;
    if (isEncryptedBlob(stored)) {
      try {
        return this.decryptJson(stored);
      } catch (err) {
        this.logger.error('Failed to decrypt connection credentials', err);
        return null;
      }
    }
    // Legacy plaintext (or masked '********' values) — return as-is so callers
    // can detect masked values and treat them as missing.
    return stored;
  }

  /** Returns true if every value in the record is the masked sentinel '********'. */
  isMasked(stored: Record<string, unknown> | null): boolean {
    if (!stored) return true;
    if (isEncryptedBlob(stored)) return false;
    const values = Object.values(stored);
    if (values.length === 0) return true;
    return values.every((v) => v === '********' || v === null || v === undefined);
  }
}
