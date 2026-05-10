# Deploying Stack62 to Render

Stack62 ships with a **Render Blueprint** (`render.yaml`) that provisions
everything in one click: Postgres, Redis, API, worker, and the frontend
static site, with all the env vars wired between them automatically.

## What gets created

| Service          | Type                | Purpose                              |
|------------------|---------------------|--------------------------------------|
| `stack62-postgres` | Postgres 16         | Application database                 |
| `stack62-redis`    | Key-Value (Redis)   | BullMQ queues + workflow state       |
| `stack62-api`      | Web Service (Docker)| NestJS API on `dist/main.js`         |
| `stack62-worker`   | Background Worker   | BullMQ + AI orchestration consumer   |
| `stack62-web`      | Static Site (Vite)  | React frontend                       |

## First-time deploy

1. Push this repo to GitHub. (Already done — the live remote is
   `https://github.com/uncletuas/stack62.com`.)
2. In Render, click **New → Blueprint**, point it at the repo, and Render
   reads `render.yaml`. It will provision the database, Redis, both Node
   services, and the static site in one transaction.
3. After the first deploy finishes, set the following env vars manually
   from the Render dashboard:
   - On `stack62-api` and `stack62-worker`:
     - `OPENROUTER_API_KEY` (for chat / planning) — *or* `ANTHROPIC_API_KEY`
       if you want direct Anthropic access. One is required.
   - On `stack62-web`:
     - `VITE_API_BASE_URL` → paste the API public URL plus `/v1`, e.g.
       `https://stack62-api.onrender.com/v1`. **Trigger a manual rebuild**
       on the static site after setting it (Vite inlines this at build).
4. Once `stack62-web` rebuilds, open it in the browser and sign up.

## How the URLs are wired

The codebase reads connection settings via
[`src/config/connection-urls.ts`](../src/config/connection-urls.ts), which
accepts **either** a single URL env var (Render's default) **or** discrete
host/port/user fields (local docker-compose).

- `DATABASE_URL` → parsed into TypeORM Postgres options. SSL is on by
  default for any non-localhost host (Render's managed Postgres requires
  TLS); pass `DATABASE_SSL=false` to override.
- `REDIS_URL` → parsed into BullMQ connection. `rediss://` (TLS) is
  detected automatically; override with `REDIS_TLS`.

So Render's blueprint just hands you `DATABASE_URL` and `REDIS_URL` from
the linked database/keyvalue services and everything connects.

## Tier-1 router (Ollama) on Render

Render web services don't run Ollama — there's no GPU, and the Tier-1
local-model path is optional. If you want it, run Ollama on a separate
host (your laptop, a small VPS) and set `OLLAMA_BASE_URL` on
`stack62-api` + `stack62-worker` to that host's URL. Without it, the
router silently falls through Tier 0 → Tier 3 (Claude) and Stack62 still
works.

## After-deploy hardening

The first deploy ships with:

- `DATABASE_SYNC=true` — TypeORM auto-creates tables on every boot. Fine
  for bootstrap, but **switch to migrations** before serving real users.
  Generate one with `npm run migration:generate -- src/migrations/Init`,
  commit it, then set `DATABASE_SYNC=false` on the API service and
  redeploy.
- `CORS_ORIGIN=*` — open to any origin. **Tighten this** to the
  `stack62-web` URL once it's live (e.g.
  `https://stack62-web.onrender.com`) on the API service.
- A 1 GB persistent disk mounted at `/var/data` for the API service.
  Files, documents, and generated systems land here. The worker writes
  to the same paths but doesn't get its own disk — Render mounts are
  per-service, so you'll either need to swap to S3-backed storage for
  durability across services, or move file-write paths to the API only.

## Local parity

Nothing about this changes how Stack62 runs locally. `docker-compose up`
still works, `.env` still uses `DATABASE_HOST` / `REDIS_HOST` discrete
fields, and the app picks them up because `DATABASE_URL` / `REDIS_URL`
aren't set.
