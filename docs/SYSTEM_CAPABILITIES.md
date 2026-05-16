# Stack62 capabilities — engine, system build, schedules

A walk through what the runtime can actually do today, the kinds of
systems an org can build with it, and the gaps between the vision
("Replit for business systems") and the current code.

Last updated: 2026-05-16.

---

## 1. The engine (Coworker AI runtime)

### Entry point
`coworker.service.ts` → `EngineService.run()` in `src/modules/engine/`.
Every user message goes through the same three-tier router:

| Tier | What runs | Cost / latency | Used for |
|------|-----------|----------------|----------|
| 0 | Regex / rule match in `IntentClassifierService` | ~0ms, free | "list pending plans", "show my systems", greetings |
| 1 | Self-hosted small model (Ollama or `SELF_HOSTED_LLM_URL`) | ~300–800ms, owned | Read-only tool selection for ambiguous list/search prompts |
| 2/3 | Anthropic Claude (`STACK62_ENGINE_MODEL`, default `claude-sonnet-4-5`) | API-priced | Tool-using reasoning, multi-step plans, writes |

Tier 1 falls through to Tier 3 transparently if the local model is
unreachable.

### Model wiring
- **Primary**: `ANTHROPIC_API_KEY` → direct Anthropic API
- **Fallback**: `OPENROUTER_API_KEY` → OpenRouter
- **Tier 1**: `OLLAMA_BASE_URL` (Ollama protocol) **or** `SELF_HOSTED_LLM_URL` (OpenAI-compatible — vLLM/TGI/Together). See `docs/self-hosted-llm.md`.
- **Realtime voice**: separate `OPENAI_API_KEY` for the WebRTC bridge.

### Tools registered (16 categories)
From `engine.module.ts`:

- `workspace.*` — `search`, navigation
- `data.*` — records CRUD on AI-built collections
- `automation.*` — workflows
- `integrations.*` — Gmail / Calendar / WhatsApp / QuickBooks (only when OAuth is configured)
- `files.*` — list, read, share, summarise
- `documents.*` — draft, edit
- `communications.*` — `email.send`, `whatsapp.send`
- `memory.*` — Coworker long-term memory CRUD
- `meetings.*` — `attend`, `list_mine`, `summary`, `speak`
- `calendar.*` — Google Calendar reads/writes
- `schedules.*` — `list`, `create`, `cancel`
- `systems.*` — list, get, describe, propose changes
- `plan.*` — `list`, `propose` (this is the route through which the AI drafts a system)
- `job.*` — `tasks.list`, `tasks.create`
- `runner.*` — deploy + status of generated systems
- `command.*` — internal commands (`open_settings`, `move_coworker_to`, etc.)

### How a request flows end-to-end
**User**: "create a task to onboard the new hire"
1. `CoworkerChatService` saves the user message and calls `EngineService.run()`.
2. `IntentClassifierService.classify()` → Tier 0 regex doesn't match → Tier 1 local model maybe matches `tasks.create`; if not, escalates to Tier 3.
3. Claude receives the base prompt + Coworker memory + tool catalog. It returns a `tool_use` block calling `tasks.create`.
4. `EngineRuntimeService.execute()` validates the input against the tool's JSON schema, runs the access-control check, and invokes the handler.
5. `JobTools` calls `TasksService.create()`.
6. Result is streamed back as `EngineEvent`s; the rail re-renders.

### Plan → Diff → Approve
For anything that mutates business state (creating a system, editing
schema, sending an external message), the engine routes through `AiService.createRequest()` and creates an `AiChangeRequest`. The user
sees the diff in a Plan editor tab and clicks Approve. Auto-apply is
a config knob per coworker.

---

## 2. System-building flow

### Schema
The canonical shape is in `src/shared/system-definition/system-definition.schema.ts`:

```
SystemDefinition
├── modules: ModuleDefinition[]
│   ├── kind: string (default 'custom')        ← intentionally open
│   └── entities: EntityDefinition[]
│       └── fields: FieldDefinition[]
│           └── dataType: string                ← intentionally open
├── views: ViewDefinition[]
│   └── type: 'table' | 'form' | 'kanban' | 'calendar' | 'chart' | 'card'
├── dashboards: DashboardDefinition[]
├── workflows: WorkflowDefinition[]
│   └── triggerType: string
└── permissionPolicies: PermissionPolicyDefinition[]
```

### What you can actually build today
Practical examples that work end-to-end against the current schema:

- **CRM** — Companies + Contacts + Deals modules, table + kanban views, "deal stage changed" workflow that drops a row into Tasks. Email send via the Gmail integration.
- **Recruiting tracker** — Candidates + Stages, table + kanban, calendar view for interviews, integration with WhatsApp Business for candidate updates.
- **Operations runbook** — checklists per shift, schedules with `assignedToCoworker=true` so the Coworker fires actions on a cadence, summary docs.
- **Lightweight project tracker** — Projects + Tasks + Comments, dashboards aggregating count-by-status, Slack-style rooms for team chat.
- **Vendor/expense system** — Invoices module with AI-extracted fields from uploaded PDFs (via the existing `extractFields` flow), QuickBooks for ledger sync.

### What's not yet built
These are gaps the schema *allows* but the runtime doesn't fully serve:

1. **Module kind is a free string** — no template catalogue. The AI can pick anything, but there's no "CRUD-template" library so each system is hand-rolled from scratch. **Fix**: ship a set of canonical templates (CRM, ATS, Inventory, Project) the AI can clone-and-modify.
2. **Workflows are unvalidated objects** — `triggerType` is just `string`, the `definition` is an opaque object. No safety check that a workflow's actions reference real tools. **Fix**: tighten the Zod schema for workflow definitions and add a dry-run validator before plans are applied.
3. **No multi-system relationships** — entities can reference other entities inside the same system but not across systems. **Fix**: add a `ForeignSystemRef` field type that resolves at runtime.
4. **No published/rollback UI** — `SystemVersionEntity` exists but the publish + rollback flow is partially stubbed. The history tab in the workspace shows versions, but the rollback service path isn't fully wired for entity migrations.
5. **No live system preview** — building a CRM today means waiting for the deploy to finish before clicking around. **Fix**: a "draft mode" toggle that runs the system inline against in-memory data so the user can try it before approve.
6. **Permission policies stored, not enforced everywhere** — `permissionPolicies` is part of the schema, but enforcement leans on a generic `AccessControlService` that's not yet aware of system-level field restrictions.

---

## 3. Schedule flow

### What it is
`ScheduleEntity` is a row with: `title`, `kind`, `startsAt`, `endsAt`, `recurrenceRule` (RFC 5545 RRULE), `assignedToCoworker`, `metadata`.

Tools on the engine side (`schedules.tools.ts`):
- `schedules.list` — read for the calendar view
- `schedules.create` — write a new row
- `schedules.cancel` — soft-delete

### What's missing
- **No firing worker.** Rows exist; nothing wakes up and triggers
  them. Meeting bot is the *only* scheduled flow with a real worker
  (BullMQ on Redis). The user types "remind me at 4pm" → a row is
  created → no reminder fires.
- **No reminder delivery.** Even after a worker exists, there's no
  notification primitive (push? email? in-app banner?). Pick one.
- **No recurrence expansion.** RRULE is stored but not evaluated.

### How to close the gap
1. Add `schedule-worker` as a sibling to `meeting-bot` worker. It polls
   the `schedules` table for rows where `nextFireAt < now()`, runs the
   action (which lives in `metadata.action`), updates `lastFiredAt`,
   advances `nextFireAt` via the RRULE.
2. Pick a notification primitive — easiest first cut is in-app via the
   already-present activity feed + the workspace flash mechanism.
3. Surface a "Next 7 days" agenda in the Schedules sidebar.

---

## 4. Improvement priorities (high → low impact)

1. **Schedule worker + reminders** — the schedule is a feature that
   *appears* to work but doesn't. Highest user-visible win.
2. **System templates** — let the AI start from a CRM/ATS/Inventory
   skeleton instead of greenfield every time. Cuts plan size 5×.
3. **Workflow validator + dry-run** — catch bad workflow definitions
   *before* apply, not at first fire.
4. **Live draft preview** — try-before-approve. Massive trust win.
5. **Per-system permission enforcement** — the schema promises it; the
   runtime needs to honour it.

---

## 5. How to manually test the engine

Run these prompts in order, check that each one produces the
described outcome:

| Prompt | Expected outcome |
|--------|------------------|
| "what can you do" | Tier 0 direct reply (instant, no LLM call) |
| "list my pending plans" | Tier 0 → `plans.list` tool, table renders |
| "search the workspace for 'invoice'" | Tier 0 → `workspace.search` |
| "what's on my calendar today" | Tier 3 → `calendar.list_events` (requires Google connected) |
| "remind me at 4 PM to call the vendor" | Tier 3 → `schedules.create` (row created, but won't actually fire) |
| "build me a CRM with Companies, Contacts, and Deals" | Tier 3 → `plans.propose` → Plan editor opens → Approve → system applied |
| "attend my 3 PM Meet (URL)" | Tier 3 → `meetings.attend` (requires meeting-bot worker live) |
| "send a Gmail to alice@example.com saying hi" | Tier 3 → `email.send` (requires Gmail connected) |

If any tier mis-routes, set `STACK62_ROUTER_DEBUG=1` and watch the
engine log — every dispatch prints `tier=N reason=...`.
