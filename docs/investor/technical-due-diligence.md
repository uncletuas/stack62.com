# Stack62 — Technical Due Diligence

*For investors, acquirers, and technical advisors.*

---

## Architecture Overview

Stack62 is a **modular monolith** — a single deployable service with 35 internally isolated modules, each with its own controller, service, entity, and DTO layers. This architecture was chosen deliberately:

- **Deployment simplicity** — one container to scale, not a microservices mesh
- **Transactional consistency** — TypeORM transactions span modules without distributed transaction complexity
- **Refactorability** — modules can be extracted to separate services as scale demands, with clear boundaries already defined

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | NestJS 11 (TypeScript) | Modular, DI-native, production-proven for APIs |
| Database | PostgreSQL 16 | Relational + JSONB for flexible schema |
| Cache / Queue | Redis 7 + BullMQ | Reliable job queuing with priority, retry, dead-letter |
| ORM | TypeORM 0.3 | Migrations, relations, multi-DB support |
| Frontend | React 18 + Vite 6 + Tailwind CSS 4 | Fast build, type-safe, modern UI patterns |
| AI Providers | Anthropic Claude, OpenRouter, Ollama | Multi-provider; no single-vendor lock-in |
| Storage | AWS S3 (prod) / local disk (dev) | Abstracted behind StorageBackend interface |
| Auth | JWT + Google OAuth + Passport | Stateless auth with refresh token rotation |
| Monitoring | Sentry (errors + performance) | Production observability |
| Deployment | Docker + Render (with Render Blueprint) | One-command production deploy |

### System Diagram (High Level)

```
┌─────────────────────────────────────────────────────────┐
│                    Stack62 API (NestJS)                  │
│                                                         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │   Auth  │ │  Engine  │ │  Systems │ │  Workflows │  │
│  └─────────┘ └──────────┘ └──────────┘ └────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Cowork │ │ Records  │ │  Docs    │ │  Billing   │  │
│  └─────────┘ └──────────┘ └──────────┘ └────────────┘  │
│         [+ 27 more modules]                              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Shared Layer                        │   │
│  │  AccessControl │ CryptoService │ StorageBackend  │   │
│  │  SystemDefinition (Zod schema) │ BaseEntity      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
          │                              │
    ┌─────┴──────┐              ┌────────┴──────┐
    │ PostgreSQL │              │  Redis + BullMQ│
    └────────────┘              └───────────────┘
          │
    ┌─────┴──────┐
    │   AWS S3   │
    └────────────┘
```

---

## Security Architecture

### Authentication & Authorization
- **JWT tokens** — RS256 signed, configurable TTL, stateless
- **Google OAuth** — PKCE flow, scoped permissions
- **RBAC** — Custom decorator/guard system (`@AccessControl()`) with per-resource, per-action, per-field restrictions
- **Multi-tenant isolation** — All queries are scoped to `workspaceId`; cross-workspace data leakage is architecturally prevented at the ORM query builder level

### Secrets Management
- **AES-256-GCM encryption** at rest for all third-party tokens (Slack bot tokens, OAuth refresh tokens, integration API keys)
- **HKDF-derived encryption key** from `JWT_SECRET` or standalone `SECRETS_KEY` env var
- Wire format: `v1.<iv-base64url>.<authTag-base64url>.<ciphertext-base64url>` — forward-compatible, handles legacy plaintext rows
- **No plaintext secrets in code** — all sensitive values injected via environment variables

### API Security
- **Rate limiting** — per-IP throttling via `@nestjs/throttler` (configurable)
- **Input validation** — all DTOs validated with `class-validator` decorators; no raw user input reaches the database layer
- **SQL injection** — TypeORM parameterised queries; no raw SQL in production paths
- **File upload** — MIME type validation, size limits, isolated storage path per org
- **CORS** — Configurable allowed origins

### Audit & Compliance
- Full **audit log** on all data mutations (who, what, when, previous value)
- **Activity feed** per workspace (user-facing history)
- **AI change history** — every AI-proposed change is stored with plan, diff, approval decision, and actor
- SOC 2 readiness checklist in `docs/soc2-readiness.md`

---

## Data Model

Stack62 stores business data in a **hybrid relational + dynamic schema** model:

- **Fixed schema tables** — users, organizations, memberships, billing, auth (standard TypeORM entities)
- **Dynamic system schema** — System definitions (modules, entities, fields) stored as versioned JSONB documents, validated by the shared Zod schema
- **Records** — Business data records stored in a flexible record store that maps to the system's field schema at runtime
- **Versioning** — System definitions are immutable once published; new versions fork the schema

This means a new business system can be created and modified entirely through the API without database migrations.

---

## AI Integration

### Provider Architecture
```
Client → AI Gateway → Provider Router → [Anthropic | OpenRouter | Ollama]
```

The `AiGatewayService` abstracts all LLM calls. Switching AI providers requires one env var change (`AI_PROVIDER`). The gateway handles:
- Token counting and credit tracking
- Response streaming
- Error handling and retry
- Model routing (different models for planning vs. execution)

### Plan → Diff → Approve Flow
1. Coworker receives user intent (natural language)
2. Engine generates a **plan** — structured list of changes (add module, add field, modify workflow)
3. Each plan is **scored for risk** (0.0–1.0) based on schema impact
4. Plan is diffed against current system state (human-readable diff)
5. User reviews and **approves or rejects** the plan
6. On approval, changes are applied atomically and versioned

This flow produces a complete history of every AI-driven change, enabling rollback to any previous state.

---

## Scalability

### Current Architecture Limits (Rough estimates)
- **Requests:** ~2,000 req/s on a single API instance (NestJS + Fastify compatible)
- **Database:** PostgreSQL can handle 10M+ records per workspace before sharding is needed
- **Queue throughput:** BullMQ on Redis 7 handles 10,000+ jobs/hour per worker instance
- **Storage:** AWS S3 is effectively unlimited

### Horizontal Scaling Path
1. **API layer** — Stateless; scale by adding Render instances (already configured in render.yaml)
2. **Worker layer** — Separate worker process (dist/worker.js); scale independently
3. **Database** — Read replicas for analytics, connection pooling (PgBouncer) for high concurrency
4. **AI** — Parallel requests to AI provider; credit system prevents runaway costs

### Known Scaling Bottlenecks
- **Semantic search** — Vector embeddings are generated synchronously; at scale, move to async queue with dedicated embedding worker
- **Document generation** — PDFkit/docx are CPU-bound; worker pool or dedicated microservice at >1,000 docs/hour
- **Meeting bot** — Each Playwright-driven bot is 300MB+ RAM; requires separate scaling tier

---

## Code Quality

### Metrics
- **TypeScript strict mode** — enabled; no implicit `any`
- **ESLint** — TypeScript ESLint + Prettier (enforced in CI)
- **Test coverage** — 10 unit test suites covering engine, records, documents, search, workflows, health
- **E2E tests** — 1 end-to-end suite (app bootstrap + health check)
- **CI** — GitHub Actions on every push: lint, typecheck, build, unit tests

### Technical Debt Assessment
| Item | Severity | Status |
|------|---------|--------|
| Stripe billing stub | Medium | Paystack live; Stripe integration in Q3 2026 roadmap |
| Semantic search sync | Low | Not a bottleneck below 10K workspaces |
| Document generation CPU | Low | Not a bottleneck at current scale |
| Meeting bot RAM | Low | Isolated service; scales independently |

**No critical technical debt.** The codebase has no hard-coded secrets, no SQL injection vectors, no plaintext secret storage, and no deprecated patterns in active use.

---

## Intellectual Property

### Owned IP
- **Plan → Diff → Approve governance loop** — novel AI change management UX, not implemented in any competing platform
- **SystemDefinition schema** — shared Zod schema that defines the grammar for AI-generated business systems; central to the platform's extensibility
- **Risk scoring algorithm** — proprietary scoring of AI change plans for human review prioritisation
- **Multi-provider AI gateway** — abstraction layer enabling hot-swappable AI models without code changes
- **Vertical blueprints** — curated JSON system definitions for specific industries (SME Ops, Legal, Healthcare)

### Open-Source Dependencies
All dependencies are commercially permissible (MIT, Apache 2.0, BSD) for SaaS deployment. No GPL/AGPL dependencies in production paths.

---

## Infrastructure Costs (Current)

| Resource | Provider | Monthly Cost |
|---------|---------|-------------|
| PostgreSQL (1GB) | Render | $20 |
| Redis (512MB) | Render | $10 |
| API service (starter) | Render | $25 |
| Worker service (starter) | Render | $25 |
| Frontend static site | Render | $0 |
| Persistent disk (1GB) | Render | $0.25 |
| **Total baseline** | | **~$80/mo** |

At 100 customers (Growth plan, $199/mo): Infrastructure = ~$400/mo, Revenue = $19,900/mo → **Infrastructure as % of revenue: 2%**

---

## Deployment & Operations

- **Zero-downtime deploys** — Render blue-green deployment; database migrations run at startup with TypeORM
- **Health check** — `GET /v1/health` (monitored by Render, returns 200 when DB + Redis are reachable)
- **Secrets rotation** — Env var updates trigger automatic redeploy on Render
- **Database backups** — Daily automated backups on Render managed Postgres; 7-day retention (upgradeable to 30-day)
- **Incident response** — Sentry error alerts + Slack notifications; runbook in `docs/` directory
