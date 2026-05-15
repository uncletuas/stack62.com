# Stack62 docs

Operator + user docs for Stack62. Markdown files in this folder are
rendered straight from GitHub as a first pass; a proper docs site
(Docusaurus / Nextra / VitePress) ships in a follow-up.

## For operators (you, deploying Stack62)

- [Deploying to Render](./deploy-render.md) — current production setup
- [Meeting bot architecture](./meeting-bot.md) — design + rollout plan
- [SOC2 readiness checklist](./soc2-readiness.md) — what's already
  in place, what's pending

## For users (your team using the deployment)

- [Quick start](./user-quickstart.md) — first 10 minutes
- [The Coworker](./user-coworker.md) — what it can do, voice mode,
  autonomous mode, memory
- [Files & sharing](./user-files.md) — folders, ACLs, share with
  anyone by email
- [Integrations](./user-integrations.md) — Slack, Google, Resend

## Environment variables

The full env reference lives in [`src/config/env.schema.ts`](../src/config/env.schema.ts).
Required vs optional:

### Required for any deploy

| Env var | What |
|---|---|
| `DATABASE_URL` | Managed Postgres (Render sets this automatically) |
| `REDIS_URL` | Managed Redis (Render sets this automatically) |
| `JWT_SECRET` | Random ≥ 32 chars |
| `OPENROUTER_API_KEY` *or* `ANTHROPIC_API_KEY` | Required for any AI |

### Strongly recommended

| Env var | What |
|---|---|
| `STORAGE_BACKEND=s3` + `AWS_*` | Persistent file storage |
| `SENTRY_DSN` + `VITE_SENTRY_DSN` | Error tracking |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Email (share invites, password reset) |
| `SECRETS_KEY` | 32-byte hex; independent rotation of secret encryption |

### Optional / feature-specific

| Env var | What |
|---|---|
| `GOOGLE_AUTH_CLIENT_ID` + `GOOGLE_AUTH_CLIENT_SECRET` + `GOOGLE_AUTH_REDIRECT_URI` | Sign in with Google |
| `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` + `SLACK_SIGNING_SECRET` | Slack integration |
| `OPENAI_API_KEY` | Real-time voice (direct OpenAI, not OpenRouter) |
| `REALTIME_MODEL` | Override the default `gpt-4o-realtime-preview` |
| `VISION_MODEL` | Override the default vision-LLM for OCR (`anthropic/claude-3.5-sonnet`) |
| `EMBEDDING_MODEL` | Override the embedding model (`openai/text-embedding-3-small`) |
| `AUDIT_RETENTION_CRON` | Override the default 03:00 UTC sweep |
| `AUDIT_RETENTION_DISABLED=true` | Turn off retention sweep entirely |
| `APP_PUBLIC_URL` | Frontend URL (used for OAuth callbacks + email links) |
