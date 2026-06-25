import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

/**
 * RFC 6238 TOTP (time-based one-time passwords) implemented on Node's built-in
 * crypto — no external dependency. Compatible with Google Authenticator, Authy,
 * 1Password, etc. (SHA-1, 6 digits, 30s step, base32 secret).
 *
 * The admin console renders the `otpauth://` URI returned by `provisioningUri`
 * as a QR code client-side, so no server-side QR library is needed either.
 */
@Injectable()
export class TotpService {
  private readonly digits = 6;
  private readonly stepSeconds = 30;
  private readonly issuer = 'Stack62 Assembly';

  /** Generate a fresh base32 TOTP secret (160 bits). */
  generateSecret(): string {
    return this.base32Encode(crypto.randomBytes(20));
  }

  /** otpauth:// URI for QR provisioning in an authenticator app. */
  provisioningUri(secret: string, accountEmail: string): string {
    const label = encodeURIComponent(`${this.issuer}:${accountEmail}`);
    const params = new URLSearchParams({
      secret,
      issuer: this.issuer,
      algorithm: 'SHA1',
      digits: String(this.digits),
      period: String(this.stepSeconds),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /**
   * Verify a code, tolerating ±1 time step (clock skew). Returns true on match.
   */
  verify(secret: string, token: string): boolean {
    const normalized = (token || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) return false;
    const counter = Math.floor(Date.now() / 1000 / this.stepSeconds);
    for (let drift = -1; drift <= 1; drift++) {
      if (this.generate(secret, counter + drift) === normalized) return true;
    }
    return false;
  }

  private generate(secret: string, counter: number): string {
    const key = this.base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return (binary % 10 ** this.digits).toString().padStart(this.digits, '0');
  }

  private base32Encode(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
  }

  private base32Decode(input: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of clean) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(bytes);
  }
}
