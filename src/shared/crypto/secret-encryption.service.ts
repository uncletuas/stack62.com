import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

/**
 * Symmetric AES-256-GCM encryption for secrets stored at rest
 * (integration API keys, OAuth tokens, password-grade fields
 * persisted in jsonb columns).
 *
 * Key derivation: HKDF-SHA256(JWT_SECRET, salt="stack62-secret-v1").
 * Same secret powers JWTs already, so there's no new credential to
 * rotate. To rotate independently, set SECRETS_KEY env (raw 32 bytes
 * hex-encoded). When SECRETS_KEY is unset and JWT_SECRET is the
 * built-in dev default, we log a warning so misconfigured prod is
 * loud.
 *
 * Wire format of an encrypted string:
 *   v1.<iv-base64url>.<authTag-base64url>.<ciphertext-base64url>
 *
 * `decrypt` is forgiving: it returns the input unchanged when it
 * doesn't recognise the v1 prefix, so legacy plaintext rows still
 * read until they're rotated.
 */
@Injectable()
export class SecretEncryptionService {
  private readonly logger = new Logger(SecretEncryptionService.name);
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('SECRETS_KEY');
    if (raw) {
      this.key = Buffer.from(raw, 'hex');
      if (this.key.length !== 32) {
        throw new Error('SECRETS_KEY must be 32 bytes hex (64 chars).');
      }
    } else {
      const jwtSecret = this.config.get<string>('JWT_SECRET') || 'stack62-dev';
      if (jwtSecret === 'stack62-local-development-secret') {
        this.logger.warn(
          '[secret-encryption] using JWT_SECRET fallback with the built-in dev default. Set SECRETS_KEY in production.',
        );
      }
      // HKDF to a fresh 32-byte key — never use JWT_SECRET bytes directly.
      const derived = crypto.hkdfSync(
        'sha256',
        Buffer.from(jwtSecret, 'utf8'),
        Buffer.from('stack62-secret-v1'),
        Buffer.from('stack62-secret-encryption'),
        32,
      );
      this.key = Buffer.from(derived);
    }
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    if (plaintext.startsWith('v1.')) return plaintext; // already encrypted
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      enc.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    if (!envelope) return envelope;
    if (!envelope.startsWith('v1.')) return envelope; // legacy plaintext
    const parts = envelope.split('.');
    if (parts.length !== 4) {
      throw new Error('Malformed encrypted envelope.');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ct = Buffer.from(ctB64, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
  }
}
