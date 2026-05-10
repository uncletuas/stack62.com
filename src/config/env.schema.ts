import { z } from 'zod';

const booleanFromString = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
      }

      return defaultValue;
    });

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_NAME: z.string().default('Stack62 Backend'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('v1'),
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().min(16).default('stack62-local-development-secret'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres'),
  DATABASE_NAME: z.string().default('stack62'),
  DATABASE_SYNC: booleanFromString(true),
  DATABASE_LOGGING: booleanFromString(false),
  DATABASE_SSL: booleanFromString(false),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_SKIP_VERSION_CHECK: booleanFromString(true),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4o-mini'),
  OPENROUTER_APP_NAME: z.string().default('Stack62 Studio Engine'),
  OPENROUTER_HTTP_REFERER: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().url().optional()),
  AI_ENABLE_REMOTE_PLANNER: booleanFromString(true),
  AI_PROVIDER: z.string().default('anthropic'),
  AI_DEFAULT_MODEL: z.string().default('claude-code:sonnet'),
  AI_REQUIRE_APPROVAL: booleanFromString(false),
  AI_INCLUDED_MONTHLY_CREDITS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(100),
  STUDIO_ARTIFACTS_DIR: z.string().default('generated/studio'),
  STUDIO_MAX_ARTIFACTS_PER_REQUEST: z.coerce
    .number()
    .int()
    .positive()
    .default(8),
  STUDIO_ALLOWED_ARTIFACT_EXTENSIONS: z
    .string()
    .default('json,md,txt,ts,tsx,yml,yaml'),
  FILE_STORAGE_ROOT: z.string().default('storage/files'),
  DOCUMENTS_STORAGE_ROOT: z.string().default('storage/documents'),
  GENERATED_SYSTEMS_ROOT: z.string().default('generated/systems'),
  GENERATED_APPS_BASE_DOMAIN: z.string().default('stack62.loopital.com'),
  RUNNER_PORT_START: z.coerce.number().int().positive().default(4100),
  RUNNER_PORT_END: z.coerce.number().int().positive().default(4500),
  RUNNER_LOGS_ROOT: z.string().default('generated/logs'),
  RUNNER_SANDBOX_MODE: z.enum(['process', 'docker']).default('process'),
  RUNNER_DOCKER_IMAGE: z.string().default('node:20-bookworm-slim'),
  RUNNER_DOCKER_NETWORK: z.string().default('bridge'),
  RUNNER_DOCKER_CPUS: z.string().default('0.5'),
  RUNNER_DOCKER_PIDS_LIMIT: z.coerce.number().int().positive().default(128),
  RUNNER_ALLOWED_DEPENDENCIES: z.string().default('express,better-sqlite3'),
  RUNNER_PROCESS_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
  RUNNER_NODE_MAX_OLD_SPACE_MB: z.coerce.number().int().positive().default(128),
  WORKFLOW_AUTOMATION_ENABLED: booleanFromString(true),
  WORKFLOW_AUTOMATION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15000),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_WHATSAPP_CONFIGURATION_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  GOOGLE_WORKSPACE_API_KEY: z.string().optional(),
  GOOGLE_WORKSPACE_CLIENT_ID: z.string().optional(),
  GOOGLE_WORKSPACE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_365_TENANT_ID: z.string().optional(),
  MICROSOFT_365_CLIENT_ID: z.string().optional(),
  MICROSOFT_365_CLIENT_SECRET: z.string().optional(),
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
  QUICKBOOKS_REDIRECT_URI: z.string().optional(),
  INTUIT_CLIENT_ID: z.string().optional(),
  INTUIT_CLIENT_SECRET: z.string().optional(),
  INTUIT_REDIRECT_URI: z.string().optional(),
  QUICKBOOKS_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_CALLBACK_URL: z.string().optional(),
  AUDIT_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(5000),
  SECURITY_REQUIRE_2FA_FOR_ADMINS: booleanFromString(true),
  SECURITY_ENABLE_IP_ALLOWLIST: booleanFromString(false),
  SECURITY_DATA_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(2555),
  SECURITY_SSO_REQUIRED: booleanFromString(false),
  CLAUDE_CODE_BIN: z.string().optional(),
  CLAUDE_CODE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  CLAUDE_CODE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  CODEX_BIN: z.string().optional(),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  CODEX_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(60),
});

export type AppEnvironment = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const normalizedConfig = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    ]),
  );
  const parsed = envSchema.safeParse(normalizedConfig);

  if (!parsed.success) {
    const formattedErrors = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${formattedErrors}`);
  }

  const env = parsed.data;
  const productionErrors: string[] = [];
  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET === 'stack62-local-development-secret') {
      productionErrors.push(
        'JWT_SECRET must be set to a non-default secret in production',
      );
    }

    if (env.DATABASE_SYNC) {
      productionErrors.push('DATABASE_SYNC must be false in production');
    }

    if (env.CORS_ORIGIN === '*') {
      productionErrors.push(
        'CORS_ORIGIN must list trusted origins in production',
      );
    }
  }

  if (productionErrors.length > 0) {
    throw new Error(
      `Environment validation failed: ${productionErrors.join('; ')}`,
    );
  }

  return env;
}
