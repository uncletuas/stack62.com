# Contributing to Stack62

Thanks for the interest. Stack62 is a young codebase moving fast —
this doc captures the rules of the road so PRs get merged quickly
and the architecture stays coherent.

## Project shape

- **Backend** — NestJS (TypeScript) at `src/`. PostgreSQL via TypeORM,
  BullMQ on Redis for jobs, modular per-feature folders under
  `src/modules/`.
- **Frontend** — React + Vite at `Stack62_design/`. shadcn/ui +
  Tailwind. State via React context (see `src/app/context/`).
- **Workers** — separate Render services at `services/`. Today just
  `meeting-bot/` (Playwright + Chromium for Google Meet automation).
- **Docs** — `docs/`. Architecture, ops runbooks, capabilities,
  business material.

A short architectural overview lives in
[`docs/stack62-backend-architecture.md`](docs/stack62-backend-architecture.md).
The full capability map is in
[`docs/SYSTEM_CAPABILITIES.md`](docs/SYSTEM_CAPABILITIES.md).

## Getting started

```bash
git clone https://github.com/uncletuas/stack62.com.git
cd stack62.com
npm install
cp .env.example .env       # fill in DATABASE_URL, JWT_SECRET, etc.
npm run migration:run       # apply DB migrations
npm run start:dev           # NestJS on :3000

# In a second terminal:
cd Stack62_design
npm install
cp .env.example .env       # set VITE_API_BASE_URL
npm run dev                 # Vite on :5173
```

A minimal Postgres + Redis stack is available via:

```bash
docker compose up -d
```

## Branching + PRs

- Branch off `main`. Use kebab-case branch names: `feat/avatar-upload`,
  `fix/realtime-stuck-after-first-reply`.
- Keep PRs small and self-contained. If you're touching the engine and
  the file explorer in the same PR, split them.
- PR titles follow the commit-message style we use throughout the
  repo: a short imperative phrase, e.g. `Add workspace.open tool +
  inline open chips`. No conventional-commit prefixes required.

## Code style

- **TypeScript everywhere.** No `.js` in `src/`.
- **No `any` unless escaping a third-party type hole.** Even then,
  narrow at the boundary.
- **Comments are mandatory** when the *why* isn't obvious from the
  code. Documenting *what* the code does is fine but say *why* it
  exists where you can — that's the part future-you needs.
- **Files stay flat where possible.** Don't introduce a `helpers/`
  folder unless three callers actually need the helper.
- **Errors are user-facing strings.** `BadRequestException("the
  X")`-style messages should be readable as-is in a chat reply.

We run ESLint (flat config) and Prettier. Run:

```bash
npm run lint
npm run format
```

before pushing. CI rejects PRs that don't pass.

## Testing

- Unit tests live next to their target: `foo.service.ts` +
  `foo.service.spec.ts`. We use Jest.
- We're not aiming for 100% coverage — we test:
  1. Anything with non-trivial branching logic.
  2. Anything that touches money, auth, or data deletion.
  3. Anything we've broken twice (regression armor).
- Run tests with `npm test`. CI runs `npm run test:cov`.

## Database changes

Always go through a migration. **Never** edit an applied migration
file — write a new one.

```bash
npm run migration:generate -- src/migrations/AddMyFeature
npm run migration:run
```

Migrations are checked in at `src/migrations/` and executed on the
API service at boot in production.

## Adding an engine tool

The Coworker's tool catalogue lives in `src/modules/engine/tools/`.
Pattern:

1. Add a method to the matching `*.tools.ts` file (or create a new
   category file if the verb doesn't fit existing ones).
2. Use the `tool(name, description, schema, handler, options?)`
   helper. Descriptions are *read by Claude* — write them like you'd
   write a docstring for a junior dev who's never seen the system.
3. Register the provider in `engine.module.ts`.

Tool action levels:
- 1 = read / safe (no confirmation prompt)
- 2 = write / scoped (autopilot-aware)
- 3 = sensitive (external send, money, deletion) — requires
  confirmation unless the user has explicitly opted in.

## Frontend conventions

- One file per editor under `Stack62_design/src/app/workspace/editors/`.
  Lazy-loaded; register in `editors/index.tsx`.
- Use the in-app dialog system (`components/app-dialog.tsx`) for
  alerts, confirms, and prompts. **Never** call `window.alert`,
  `window.confirm`, or `window.prompt`.
- Use theme tokens (`bg-app`, `text-app`, `border-app`,
  `bg-app-elevated`, etc.) instead of hardcoded `bg-slate-900`-style
  colors. The light/dark theme switch only works if everything goes
  through the tokens.

## Security

If you find a vulnerability, **do not** open a public issue. See
[`SECURITY.md`](SECURITY.md) for the disclosure process.

## License

By contributing you agree your contributions will be licensed under
the same license as the project (see [`LICENSE`](LICENSE)).
