# Stack62 Backend Architecture (MVP Baseline)

## 1) Objective

Stack62 backend is a **multi-tenant AI-native business operating platform** that can:

- create named systems from prompts,
- generate and evolve modules (HR, finance, procurement, CRM, inventory, operations, etc.),
- run those systems at runtime with governed data + workflow execution,
- share systems with controlled access modes,
- preserve safety through structured AI plans, validation, versioning, and auditability.

This architecture intentionally avoids uncontrolled AI self-rewriting code paths.

---

## 2) Architecture style

### Current implementation model

- **Modular monolith (NestJS)** with domain modules and explicit boundaries.
- **PostgreSQL** as source of truth for platform entities, system definitions, and runtime records.
- **Redis + BullMQ** for asynchronous AI orchestration and background jobs.
- **Dedicated worker bootstrap** (`src/worker.ts`) for background processors.

### Why modular monolith for MVP

- Faster delivery with lower operational complexity than microservices.
- Strong domain separation still preserved in module boundaries.
- Allows future extraction into services once throughput/team scale justifies it.

---

## 3) Domain model and logical ERD

## 3.1 Tenant hierarchy

```text
Platform
  └── Organization
       └── Workspace
            └── System
                 ├── SystemVersion
                 │    ├── ModuleDefinition
                 │    │    └── EntityDefinition
                 │    │         └── FieldDefinition
                 │    ├── ViewConfig
                 │    └── DashboardConfig
                 ├── RuntimeRecord
                 ├── WorkflowDefinition
                 ├── Task
                 ├── Schedule
                 ├── PermissionPolicy
                 └── SharePackage
```

## 3.2 Platform entities

- `users`
- `organizations`
- `workspaces`
- `memberships`
- `activity_logs`
- `audit_logs`

## 3.3 System-definition entities

- `systems`
- `system_versions`
- `module_definitions`
- `entity_definitions`
- `field_definitions`
- `view_configs`
- `dashboard_configs`

## 3.4 Runtime entities

- `runtime_records`
- `workflow_definitions`
- `tasks`
- `schedules`

## 3.5 Governance/AI/job entities

- `permission_policies`
- `share_packages`
- `ai_change_requests`
- `ai_change_plans`
- `ai_validation_results`
- `background_jobs`

---

## 4) API contract groups (MVP)

All endpoints are prefixed by `/{API_PREFIX}` (default: `/v1`).

### Platform

- `/auth`
- `/users`
- `/organizations`
- `/workspaces`
- `/memberships`
- `/activity`
- `/audit`

### System engine

- `/systems`
  - create system definitions
  - list systems
  - view versions
  - publish versions

### Runtime

- `/records`
- `/workflows/definitions`
- `/tasks`
- `/schedule`

### Governance

- `/permissions/policies`
- `/sharing/packages`

### AI + jobs

- `/ai/requests`
- `/jobs`

### Platform operations

- `/health`
- `/docs` (Swagger UI)

---

## 5) Multi-tenant model design

Tenant boundary is enforced via identifiers on entities:

- `organizationId`
- `workspaceId`
- optional `systemId` for scoped records

Design intent:

- All reads/writes are scoped by tenant context.
- Future hardening:
  - request-scoped tenant context middleware,
  - reusable query guards,
  - policy engine integration for row/field-level restrictions.

---

## 6) Permissions model design

Current baseline uses `permission_policies` with:

- scope (`organization`, `workspace`, `system`, `module`, etc.)
- role (`admin`, `manager`, `staff`, `reviewer`, `read-only`, etc.)
- resource type
- allowed actions array
- optional field restrictions and conditions

This gives a structured bridge toward full RBAC/ABAC enforcement.

---

## 7) AI orchestration flow

### 7.1 Goal

Ensure every AI change is:

- structured,
- validated,
- versioned,
- auditable,
- safely applied.

### 7.2 Implemented flow

1. Client submits `POST /ai/requests`.
2. Request stored in `ai_change_requests`.
3. Job enqueued in `background_jobs` and BullMQ queue.
4. Worker (`AiProcessor`) loads request and invokes planner.
5. Planner emits structured plan (`AiChangePlan`) validated by Zod.
6. Plan stored in `ai_change_plans`.
7. Validation stored in `ai_validation_results`.
8. If `autoApply` and valid:
   - Create/publish system OR create draft version update.
9. Activity + audit logs persisted.

### 7.3 Guardrails

- No free-form text directly mutates production schema.
- Structured schema required for AI actions.
- Validation gate before apply.
- Version-first updates for system evolution.
- Job lifecycle tracked for observability.

---

## 8) Workflow engine design (MVP foundation)

`workflow_definitions` stores reusable workflow metadata:

- trigger type
- structured definition payload
- module/system associations
- status lifecycle (draft/active extension path)

Next phase upgrades:

- execution runtime (state machine)
- transitions + conditions
- approvals/actors
- escalations/reminders
- event hooks/webhooks

---

## 9) Versioning and rollback strategy

### Current strategy

- Every generated system begins with `system_versions` draft v1.
- Publishing marks a version as `published` and archives prior published version.
- AI update flow can generate new draft versions with change summary and source prompt.

### Rollback path

- Publish a previous archived version as latest active version.
- Maintain `definitionSnapshot` and optional `compiledSnapshot` per version.

---

## 10) Database schema proposal summary

### Relational + JSONB hybrid

- Core identity and hierarchy fields stored relationally.
- Flexible generated configs stored as JSONB for:
  - AI plans,
  - dashboards/widgets,
  - workflow definitions,
  - record payloads.

Benefits:

- keeps structure for governance and queryability,
- preserves flexibility for generated domain variation.

---

## 11) Folder and service structure

```text
src/
  main.ts
  worker.ts
  app.module.ts
  worker.module.ts
  config/
  shared/
  modules/
    auth/
    users/
    organizations/
    workspaces/
    memberships/
    activity/
    audit/
    systems/
    records/
    workflows/
    tasks/
    schedules/
    permissions/
    sharing/
    ai/
    jobs/
```

Each module owns controller/service/dto/entity boundaries.

---

## 12) Deployment and environment plan

### Local/dev

- `.env.example` provided
- Docker Compose services:
  - `postgres`
  - `redis`
  - `api`
  - `worker`

### Production baseline

- API and worker run as separate deploy units.
- Shared managed PostgreSQL + Redis.
- Disable `DATABASE_SYNC` and use migrations.
- Add centralized logs/metrics/alerts.

---

## 13) Phase roadmap

## Phase 1 (delivered baseline)

- Auth and tenant platform core
- System definition engine foundation
- Runtime CRUD foundations (records/tasks/schedules)
- Permissions and sharing foundations
- AI plan/validation/job orchestration skeleton
- Docker + worker wiring + docs

## Phase 2

- Strong tenant policy guards across all query paths
- Full workflow execution engine (stateful runtime)
- richer version diff/compare/rollback endpoints
- dashboard/report query builders
- hardened AI provider integration + policy enforcement

## Phase 3

- Integrations + webhooks + external APIs
- enterprise SSO and advanced security controls
- analytics materialization and advanced reporting
- optional plugin/sandbox extension model

---

## 14) Risk and hardening checklist (next)

- Replace `synchronize: true` with migration pipeline.
- Add request-tenant binding middleware and guard-level enforcement.
- Expand automated test suite per module + permission scenarios.
- Add idempotency + retry strategy for background jobs.
- Add secrets management and production-safe config validation.
