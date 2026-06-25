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
  // Render / Heroku / Railway / Fly: a single connection URL is provided.
  // When set, it overrides the discrete fields below.
  DATABASE_URL: z.string().optional(),
  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres'),
  DATABASE_NAME: z.string().default('stack62'),
  DATABASE_SYNC: booleanFromString(true),
  DATABASE_LOGGING: booleanFromString(false),
  DATABASE_SSL: booleanFromString(false),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: booleanFromString(false),
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
  // ── Frontier provider (high-level tasks). OpenAI primary by owner choice;
  // OpenRouter/Anthropic remain configurable fallbacks. ──────────────────
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  // Premium model for hard reasoning / generation; cheap model for mid tasks.
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_MODEL_CHEAP: z.string().default('gpt-4o-mini'),
  ANTHROPIC_MODEL: z.string().optional(),
  // ── Local intelligence tier (self-hosted, $0 marginal cost). ───────────
  // Reachable via OLLAMA_BASE_URL (native) or SELF_HOSTED_LLM_URL (OpenAI API).
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1'),
  SELF_HOSTED_LLM_URL: z.string().optional(),
  SELF_HOSTED_LLM_MODEL: z.string().optional(),
  SELF_HOSTED_LLM_API_KEY: z.string().optional(),
  // ── Embeddings (defaults to self-hosted Ollama nomic-embed-text). ──────
  EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  OPENAI_EMBEDDING_BASE_URL: z.string().optional(),
  // ── Cost-saving intelligence router. ───────────────────────────────────
  // Master switch for Tier 0/1/1.5 local routing (already read by the engine).
  STACK62_ROUTER_ENABLED: booleanFromString(true),
  // Tier-2 local conversational answers (advice/Q&A/drafting on the local model
  // at $0). Only actions escalate to the frontier. Set false to always escalate.
  STACK62_LOCAL_CHAT_ENABLED: booleanFromString(true),
  // Semantic response/intent cache — replays prior local resolutions at $0.
  AI_RESPONSE_CACHE_ENABLED: booleanFromString(true),
  AI_RESPONSE_CACHE_THRESHOLD: z.coerce.number().default(0.92),
  AI_RESPONSE_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // Per-org monthly frontier spend cap (USD). 0 = unlimited. When near the
  // cap the budget governor forces the downgrade ladder (frontier→mini→local).
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(0),
  AI_BUDGET_WARN_RATIO: z.coerce.number().default(0.8),
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
  RUNNER_ALLOWED_DEPENDENCIES: z.string().default('express,pg'),
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
  // Incoming-email polling (Gmail + SMTP/IMAP) for the inbox + proactive coworker.
  EMAIL_POLLING_ENABLED: booleanFromString(true),
  EMAIL_POLLING_INTERVAL_MS: z.coerce.number().int().positive().default(120000),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  // SMTP transport — send from a normal email account (Gmail, business
  // mailbox, etc.) without verifying a domain on a transactional provider.
  // When SMTP_HOST + SMTP_USER + SMTP_PASSWORD are set, EmailSenderService
  // prefers SMTP over Resend.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // true => implicit TLS (port 465); false => STARTTLS (port 587). Left
  // undefined when unset so EmailSenderService can infer it from the port.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? undefined
        : v.toLowerCase() === 'true',
    ),
  // Envelope From. Falls back to RESEND_FROM_EMAIL, then SMTP_USER.
  SMTP_FROM_EMAIL: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .pipe(z.string().email().optional()),
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().optional(),
  META_WHATSAPP_CONFIGURATION_ID: z.string().optional(),
  // WhatsApp "Link a device" (Baileys companion-device) flow. Defaults on;
  // set to false to disable phone-number pairing on a deployment.
  WHATSAPP_WEB_ENABLED: booleanFromString(true),
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
  // ── Admin / operations console (assembly.loopital.com). Staff auth uses a
  // SEPARATE signing secret + JWT audience from customers, so a leaked
  // customer token can never reach /v1/admin/*. Falls back to a dev default;
  // production MUST set a non-default value (enforced below). ───────────────
  ADMIN_JWT_SECRET: z
    .string()
    .min(16)
    .default('stack62-admin-development-secret'),
  ADMIN_JWT_EXPIRES_IN: z.string().default('8h'),
  ADMIN_2FA_CHALLENGE_EXPIRES_IN: z.string().default('10m'),
  // One-off bootstrap of the first super_admin via `npm run admin:seed`.
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),
  ADMIN_SEED_FIRST_NAME: z.string().default('Platform'),
  ADMIN_SEED_LAST_NAME: z.string().default('Owner'),
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
  // In-app web browser (server-side Playwright/Chromium). When disabled the
  // browser editor + coworker web.* tools are unavailable and the backend
  // never launches Chromium (useful for deployments without the browser layer).
  BROWSER_ENABLED: booleanFromString(true),
  BROWSER_MAX_SESSIONS: z.coerce.number().int().positive().default(10),
  BROWSER_SESSION_IDLE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  BROWSER_NAV_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  BROWSER_VIEWPORT_WIDTH: z.coerce.number().int().positive().default(1280),
  BROWSER_VIEWPORT_HEIGHT: z.coerce.number().int().positive().default(800),
  BROWSER_DEFAULT_ENGINE: z.string().default('duckduckgo'),
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
  const productionWarnings: string[] = [];
  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET === 'stack62-local-development-secret') {
      productionErrors.push(
        'JWT_SECRET must be set to a non-default secret in production',
      );
    }

    if (env.ADMIN_JWT_SECRET === 'stack62-admin-development-secret') {
      productionErrors.push(
        'ADMIN_JWT_SECRET must be set to a non-default secret in production',
      );
    }

    // DATABASE_SYNC=true is needed for first-deploy bootstrap before any
    // migrations exist for fresh tables. Warn (don't block) so a hosted
    // platform like Render can come up cleanly; turn this off and switch
    // to migrations once the schema is settled.
    if (env.DATABASE_SYNC) {
      productionWarnings.push(
        'DATABASE_SYNC=true in production: TypeORM will mutate your schema on every boot. Switch to migrations once the schema is stable.',
      );
    }

    // CORS_ORIGIN=* is acceptable for the very first deploy when the
    // frontend URL isn't known yet. Warn loudly.
    if (env.CORS_ORIGIN === '*') {
      productionWarnings.push(
        'CORS_ORIGIN=* in production: any origin can call the API. Restrict this to your frontend URL(s).',
      );
    }
  }

  if (productionErrors.length > 0) {
    throw new Error(
      `Environment validation failed: ${productionErrors.join('; ')}`,
    );
  }

  for (const warning of productionWarnings) {
    console.warn(`[env] ${warning}`);
  }

  return env;
}
