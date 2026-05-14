import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SecretEncryptionService } from './secret-encryption.service';

/**
 * Global crypto module. Exposes SecretEncryptionService to any
 * module that needs to encrypt/decrypt secrets at rest without
 * having to import this module explicitly each time.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SecretEncryptionService],
  exports: [SecretEncryptionService],
})
export class CryptoModule {}
