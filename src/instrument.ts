/**
 * Sentry instrumentation. Imported first thing in main.ts so traces /
 * errors capture from the very first request.
 *
 * Operator-configured via env:
 *   SENTRY_DSN          (required to enable; leave unset to disable)
 *   SENTRY_ENVIRONMENT  (defaults to NODE_ENV)
 *   SENTRY_RELEASE      (defaults to RENDER_GIT_COMMIT or 'dev')
 *   SENTRY_TRACES_SAMPLE_RATE   (defaults to 0.1)
 *
 * Without a DSN this module is a no-op — local dev and CI don't
 * fire-and-forget errors to Sentry.
 */
import * as Sentry from '@sentry/node';

// Sentry SDK v8 no longer re-exports the `Integration` type from @sentry/node.
// Derive it from the profiling integration's own return type so this stays
// correct across SDK versions without naming a moved export.
type SentryIntegration = ReturnType<
  typeof import('@sentry/profiling-node').nodeProfilingIntegration
>;

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  // Profiling uses a native addon that may not be available on all platforms
  // (e.g. Alpine musl). Load it lazily so a missing binary doesn't crash startup.
  let profilingIntegrations: SentryIntegration[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nodeProfilingIntegration } = require('@sentry/profiling-node') as {
      nodeProfilingIntegration: () => SentryIntegration;
    };
    profilingIntegrations = [nodeProfilingIntegration()];
  } catch {
    console.warn(
      '[sentry] profiling-node unavailable on this platform — profiling disabled',
    );
  }

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release:
      process.env.SENTRY_RELEASE ||
      process.env.RENDER_GIT_COMMIT?.slice(0, 8) ||
      'dev',
    integrations: profilingIntegrations,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: Number(
      process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1',
    ),
    // Strip PII at the SDK before it leaves the box.
    sendDefaultPii: false,
    beforeSend(event) {
      // Drop Authorization headers and cookies from request data.
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['Authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['Cookie'];
      }
      return event;
    },
  });

  console.log(
    `[sentry] backend initialised (env=${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'})`,
  );
}

export { Sentry };
