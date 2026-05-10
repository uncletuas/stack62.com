import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PutObjectInput,
  PutObjectResult,
  StorageBackend,
} from './storage-backend.interface';

@Injectable()
export class LocalDiskBackend implements StorageBackend {
  readonly name = 'local-disk';
  private readonly logger = new Logger(LocalDiskBackend.name);
  private readonly root: string;

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.get<string>('FILE_STORAGE_ROOT', '');
    this.root = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'storage', 'files');
    fs.mkdirSync(this.root, { recursive: true });
  }

  isDurable(): boolean {
    // True only if the operator mounted a durable disk; we can't detect
    // that here, so we default to false (Render's free tier is ephemeral).
    return this.configService.get<string>('FILE_STORAGE_DURABLE') === 'true';
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const abs = this.absPath(input.key);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, input.body);
    return {
      etag: crypto.createHash('sha256').update(input.body).digest('hex'),
      size: input.body.length,
    };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.absPath(key));
  }

  async deleteObject(key: string): Promise<void> {
    const abs = this.absPath(key);
    try {
      await fs.promises.unlink(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') throw err;
    }
  }

  private absPath(key: string): string {
    // Defend against path-traversal in keys.
    const safe = key.replace(/\\/g, '/').replace(/(^|\/)\.\.(\/|$)/g, '$1$2');
    return path.join(this.root, safe);
  }
}
