/**
 * One-off bootstrap for the first platform super_admin (assembly.loopital.com).
 *
 *   ADMIN_SEED_EMAIL=you@loopital.com \
 *   ADMIN_SEED_PASSWORD='a-long-strong-password' \
 *   npm run admin:seed
 *
 * Idempotent: if a staff account with that email already exists it does
 * nothing. There is deliberately NO public staff signup route — this script
 * (run with shell access to the server) is the only way to mint the first
 * account; every later account is created from inside the console.
 *
 * The seeded account can log in immediately and is required to enrol 2FA on
 * first login before any session token is issued.
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { PlatformStaffService } from '../modules/admin/platform-staff.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const config = app.get(ConfigService);
    const staffService = app.get(PlatformStaffService);

    const email = config.get<string>('ADMIN_SEED_EMAIL');
    const password = config.get<string>('ADMIN_SEED_PASSWORD');
    if (!email || !password) {
      throw new Error(
        'Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD before running admin:seed.',
      );
    }
    if (password.length < 12) {
      throw new Error('ADMIN_SEED_PASSWORD must be at least 12 characters.');
    }

    const existing = await staffService.findByEmail(email);
    if (existing) {
      console.log(`[admin:seed] Staff already exists for ${email}; skipping.`);
      return;
    }

    const created = await staffService.create({
      email,
      password,
      firstName: config.get<string>('ADMIN_SEED_FIRST_NAME', 'Platform'),
      lastName: config.get<string>('ADMIN_SEED_LAST_NAME', 'Owner'),
      role: 'super_admin',
      mustResetPassword: false,
    });
    console.log(
      `[admin:seed] Created super_admin ${created.email} (${created.id}). ` +
        'Log in at assembly.loopital.com and enrol 2FA now.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[admin:seed] Failed:', error.message ?? error);
  process.exit(1);
});
