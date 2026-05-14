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
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release:
      process.env.SENTRY_RELEASE ||
      process.env.RENDER_GIT_COMMIT?.slice(0, 8) ||
      'dev',
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1',
    ),
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
  // eslint-disable-next-line no-console
  console.log(
    `[sentry] backend initialised (env=${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'})`,
  );
}

export { Sentry };
