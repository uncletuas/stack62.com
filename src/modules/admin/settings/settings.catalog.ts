/**
 * Catalog of env-backed variables that staff may override at runtime from the
 * admin console. Showing them here lets the UI render an editable row even
 * before a DB override exists. `secret` values are write-only in the UI and
 * encrypted at rest. Consuming code reads them through SettingsService.resolve()
 * so a DB override wins over the .env value without a redeploy.
 */
export interface SettingDescriptor {
  key: string;
  category: string;
  secret: boolean;
  description: string;
}

export const SETTINGS_CATALOG: SettingDescriptor[] = [
  // AI / LLM providers
  { key: 'OPENAI_API_KEY', category: 'ai', secret: true, description: 'OpenAI frontier API key.' },
  { key: 'OPENAI_MODEL', category: 'ai', secret: false, description: 'Primary OpenAI model id.' },
  { key: 'OPENAI_MODEL_CHEAP', category: 'ai', secret: false, description: 'Cheaper OpenAI model for mid-tier tasks.' },
  { key: 'OPENROUTER_API_KEY', category: 'ai', secret: true, description: 'OpenRouter fallback API key.' },
  { key: 'OPENROUTER_MODEL', category: 'ai', secret: false, description: 'OpenRouter model id.' },
  { key: 'ANTHROPIC_MODEL', category: 'ai', secret: false, description: 'Anthropic model id (optional).' },
  // Google
  { key: 'GOOGLE_CLIENT_ID', category: 'google', secret: false, description: 'Google OAuth client ID (sign-in).' },
  { key: 'GOOGLE_CLIENT_SECRET', category: 'google', secret: true, description: 'Google OAuth client secret.' },
  { key: 'GOOGLE_REDIRECT_URI', category: 'google', secret: false, description: 'Google OAuth redirect URI.' },
  { key: 'GOOGLE_WORKSPACE_API_KEY', category: 'google', secret: true, description: 'Google Workspace API key.' },
  { key: 'GOOGLE_WORKSPACE_CLIENT_ID', category: 'google', secret: false, description: 'Google Workspace OAuth client ID.' },
  { key: 'GOOGLE_WORKSPACE_CLIENT_SECRET', category: 'google', secret: true, description: 'Google Workspace OAuth client secret.' },
  // Microsoft 365
  { key: 'MICROSOFT_365_TENANT_ID', category: 'microsoft', secret: false, description: 'Microsoft 365 tenant ID.' },
  { key: 'MICROSOFT_365_CLIENT_ID', category: 'microsoft', secret: false, description: 'Microsoft 365 client ID.' },
  { key: 'MICROSOFT_365_CLIENT_SECRET', category: 'microsoft', secret: true, description: 'Microsoft 365 client secret.' },
  // QuickBooks / Intuit
  { key: 'QUICKBOOKS_CLIENT_ID', category: 'quickbooks', secret: false, description: 'QuickBooks client ID.' },
  { key: 'QUICKBOOKS_CLIENT_SECRET', category: 'quickbooks', secret: true, description: 'QuickBooks client secret.' },
  { key: 'QUICKBOOKS_ENVIRONMENT', category: 'quickbooks', secret: false, description: "QuickBooks env: 'sandbox' or 'production'." },
  // Payments (Paystack)
  { key: 'PAYSTACK_SECRET_KEY', category: 'payments', secret: true, description: 'Paystack secret key.' },
  { key: 'PAYSTACK_PUBLIC_KEY', category: 'payments', secret: false, description: 'Paystack public key.' },
  { key: 'PAYSTACK_CALLBACK_URL', category: 'payments', secret: false, description: 'Paystack payment callback URL.' },
  // Email
  { key: 'RESEND_API_KEY', category: 'email', secret: true, description: 'Resend transactional email API key.' },
  { key: 'SMTP_HOST', category: 'email', secret: false, description: 'SMTP host for outbound mail.' },
  { key: 'SMTP_USER', category: 'email', secret: false, description: 'SMTP username.' },
  { key: 'SMTP_PASSWORD', category: 'email', secret: true, description: 'SMTP password.' },
  // WhatsApp
  { key: 'META_WHATSAPP_ACCESS_TOKEN', category: 'whatsapp', secret: true, description: 'Meta WhatsApp Cloud API access token.' },
  { key: 'META_WHATSAPP_PHONE_NUMBER_ID', category: 'whatsapp', secret: false, description: 'Meta WhatsApp phone number id.' },
  // Feature flags
  { key: 'EMAIL_POLLING_ENABLED', category: 'flags', secret: false, description: 'Enable inbox polling (true/false).' },
  { key: 'BROWSER_ENABLED', category: 'flags', secret: false, description: 'Enable server-side browser (true/false).' },
  { key: 'WORKFLOW_AUTOMATION_ENABLED', category: 'flags', secret: false, description: 'Enable workflow automation scanner (true/false).' },
  { key: 'WHATSAPP_WEB_ENABLED', category: 'flags', secret: false, description: 'Enable WhatsApp "link a device" (true/false).' },
  { key: 'AI_RESPONSE_CACHE_ENABLED', category: 'flags', secret: false, description: 'Enable semantic AI response cache (true/false).' },
  // Security parameters
  { key: 'SECURITY_REQUIRE_2FA_FOR_ADMINS', category: 'security', secret: false, description: 'Require 2FA for admin staff (true/false).' },
  { key: 'SECURITY_ENABLE_IP_ALLOWLIST', category: 'security', secret: false, description: 'Enforce per-staff IP allowlist (true/false).' },
  { key: 'SECURITY_SSO_REQUIRED', category: 'security', secret: false, description: 'Require SSO for customer sign-in (true/false).' },
  { key: 'CORS_ORIGIN', category: 'security', secret: false, description: 'Allowed CORS origins (comma-separated; restart to apply).' },
  // AI cost guardrails (excess-drain protection). Budget governor reads these.
  { key: 'AI_MONTHLY_BUDGET_USD', category: 'ai', secret: false, description: 'Per-org monthly frontier spend cap in USD (0 = unlimited).' },
  { key: 'AI_BUDGET_WARN_RATIO', category: 'ai', secret: false, description: 'Fraction of budget that triggers the downgrade ladder (e.g. 0.8).' },
  { key: 'STACK62_ROUTER_ENABLED', category: 'ai', secret: false, description: 'Cost-saving local routing master switch (true/false).' },
  { key: 'STACK62_LOCAL_CHAT_ENABLED', category: 'ai', secret: false, description: 'Answer advice/Q&A on the local model at $0 (true/false).' },
  { key: 'AI_RESPONSE_CACHE_ENABLED', category: 'ai', secret: false, description: 'Replay prior local resolutions from cache (true/false).' },
  { key: 'AI_ENABLE_REMOTE_PLANNER', category: 'ai', secret: false, description: 'Allow frontier planner escalation (true/false).' },
  // Traffic / throttling (restart to apply to the global throttler).
  { key: 'THROTTLE_TTL', category: 'traffic', secret: false, description: 'Throttler window in seconds.' },
  { key: 'THROTTLE_LIMIT', category: 'traffic', secret: false, description: 'Max requests per window per IP.' },
  // Observability + runtime
  { key: 'SENTRY_DSN', category: 'observability', secret: true, description: 'Sentry DSN for backend error reporting.' },
  { key: 'SENTRY_TRACES_SAMPLE_RATE', category: 'observability', secret: false, description: 'Sentry trace sample rate (0-1).' },
  { key: 'RUNNER_SANDBOX_MODE', category: 'runtime', secret: false, description: "Generated-app sandbox: 'process' or 'docker'." },
];

export function findDescriptor(key: string): SettingDescriptor | undefined {
  return SETTINGS_CATALOG.find((d) => d.key === key);
}
