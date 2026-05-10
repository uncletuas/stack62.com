import { validateEnv } from './env.schema';

describe('validateEnv production safeguards', () => {
  it('rejects production startup with development defaults', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'stack62-local-development-secret',
        DATABASE_SYNC: 'true',
        CORS_ORIGIN: '*',
      }),
    ).toThrow(/JWT_SECRET.*DATABASE_SYNC.*CORS_ORIGIN/);
  });

  it('accepts production startup with hardened settings', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'replace-with-a-real-32-byte-secret',
      DATABASE_SYNC: 'false',
      CORS_ORIGIN: 'https://app.stack62.example',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_SYNC).toBe(false);
  });
});
