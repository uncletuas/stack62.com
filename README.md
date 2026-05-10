# Stack62 Backend

Stack62 backend is a **multi-tenant AI-native business operating platform** built with NestJS, PostgreSQL, Redis, and BullMQ.

It is designed as a **controlled, configuration-driven platform** where AI can generate and evolve business systems (HR, finance, procurement, CRM, inventory, operations, etc.) safely through structured plans, validation, versioning, and audited apply flows.

## MVP architecture snapshot

- **Runtime/API:** NestJS modular monolith
- **Database:** PostgreSQL (TypeORM)
- **Queue + cache:** Redis + BullMQ
- **Worker:** Dedicated Nest application context (`src/worker.ts`) for background AI orchestration jobs
- **Security baseline:** JWT auth, request validation, throttling, activity + audit logging

## Implemented domain modules

- Platform: auth, users, organizations, workspaces, memberships, activity, audit
- System engine: systems, system versions, module/entity/field/view/dashboard definitions
- Runtime foundations: records, workflows (definitions), tasks, schedules
- Governance: permissions, sharing
- AI orchestration: AI requests, plans, validation results, async job lifecycle
- Jobs: background job registry and queue tracking

## Quick start

### 1) Install

```bash
npm install
```

### 2) Configure

```bash
copy .env.example .env
```

### 3) Start API and worker

```bash
# API
npm run start:dev

# Worker (separate terminal)
npm run start:worker:dev
```

Swagger docs: `http://localhost:3000/v1/docs`

## Docker compose

```bash
copy .env.example .env
docker compose up --build
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis 7: `localhost:6379`
- Worker: background processor container

BullMQ requires a real Redis-compatible server with Lua scripting support. If
the worker logs `Unknown Redis command called from Lua script`, point
`REDIS_HOST` at the Compose `redis:7-alpine` service or a managed Redis plan
that supports BullMQ scripts.

## Production safety notes

Production startup refuses unsafe development defaults:

- `JWT_SECRET` must not be `stack62-local-development-secret`
- `DATABASE_SYNC` must be `false`; use migrations for schema changes
- `CORS_ORIGIN` must list trusted origins instead of `*`
- `AI_REQUIRE_APPROVAL=true` keeps all AI-generated structural changes in a human approval queue
- `RUNNER_SANDBOX_MODE=docker` runs generated apps in Docker instead of the backend Node process

Recommended first production target:

- Hosting: Render for the first commercial MVP, then AWS ECS when generated-app isolation and scaling become the bottleneck
- Database: managed PostgreSQL on Render or AWS RDS
- Redis: managed Redis on Render or AWS ElastiCache/MemoryDB
- File storage: local disk for development, S3-compatible object storage before multi-instance production
- Generated app domain: `stack62.loopital.com` with subdomain routing planned for `*.stack62.loopital.com`

The chosen first vertical MVP is in `docs/sme-ops-mvp-blueprint.json`: SME operations CRM + approval queue + documents + notifications + payment tracking.

## Provider integrations

The integration layer includes production endpoints for:

- Resend email: `POST /v1/integrations/email/send`
- WhatsApp Cloud API text messages: `POST /v1/integrations/whatsapp/send`
- Paystack initialize/verify: `POST /v1/integrations/payments/paystack/initialize` and `/verify`
- Generic webhook dispatch with private-network URL blocking: `POST /v1/integrations/webhook/dispatch`

Set the matching environment variables from `.env.example`. Do not commit real provider keys.

## Audit export

Administrators can export tenant-scoped audit logs as CSV:

```bash
GET /v1/audit/export.csv?organizationId=<org-id>
```

## Verification commands

```bash
npm run build
npm run test
npm run test:e2e
npm run lint:check
```

## Database migrations

Do not use TypeORM `synchronize` in production. Generate and run migrations:

```bash
npm run migration:generate -- src/migrations/DescribeChange
npm run migration:run
```

For production, set:

```bash
DATABASE_SYNC=false
```

If you are running generated apps through Docker, set:

```bash
RUNNER_SANDBOX_MODE=docker
RUNNER_DOCKER_IMAGE=node:20-bookworm-slim
RUNNER_DOCKER_NETWORK=bridge
```

## Documentation

See `docs/stack62-backend-architecture.md` for:

- backend architecture document
- domain model and ERD (logical)
- API contract groups
- tenant model
- permissions model
- AI orchestration flow
- workflow engine design
- versioning strategy
- database schema proposal
- phase roadmap
- folder/service structure
- deployment setup plan
