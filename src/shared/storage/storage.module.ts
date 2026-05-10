import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalDiskBackend } from './local-disk.backend';
import { S3Backend } from './s3.backend';
import { StorageBackend } from './storage-backend.interface';

export const STORAGE_BACKEND = Symbol('STORAGE_BACKEND');

const storageProvider: Provider = {
  provide: STORAGE_BACKEND,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): StorageBackend => {
    const backend = (
      configService.get<string>('STORAGE_BACKEND') || 'local'
    ).toLowerCase();
    if (backend === 's3') {
      return new S3Backend(configService);
    }
    if (backend !== 'local') {
      throw new Error(
        `Unknown STORAGE_BACKEND="${backend}" — expected "local" or "s3".`,
      );
    }
    return new LocalDiskBackend(configService);
  },
};

@Module({
  imports: [ConfigModule],
  providers: [storageProvider],
  exports: [storageProvider],
})
export class StorageModule {}
