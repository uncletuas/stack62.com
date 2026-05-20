# Stack62 AI-native workspace — architecture

The single source of truth for how documents, spreadsheets, and
presentations live in Stack62. Anything implementing or extending the
office suite reads from this doc.

Status: **foundation** (workspace-actions schema + WorkspaceActionService
implemented). UI editors against this foundation roll out in subsequent
phases. See the `Roadmap` section.

---

## Principles

1. **State-first.** The UI is a renderer of shared workspace state.
   It is never the source of truth.
2. **Action-as-event.** Every mutation, by a human or an AI, is a
   typed action dispatched to the same pipeline. There is no
   "AI path" and "human path" — there's one path, parameterised by
   `actorKind`.
3. **CRDT for live, durable for cold.** Yjs is the in-memory shape;
   Postgres stores the encoded Yjs state binary at rest plus an
   audit log of actions.
4. **AI talks to state, not pixels.** Coworker tools dispatch actions
   against object ids. They never simulate clicks, never read the
   DOM, never depend on UI being mounted.
5. **One id space.** Documents, blocks, sheets, cells, slides,
   elements — every addressable thing has a uuid. Actions reference
   ids.

---

## Object model

```
WorkspaceDoc                       — top-level container
├── kind: 'document' | 'sheet' | 'slides'
├── title
├── ownerOrganizationId / workspaceId / createdByUserId
├── yjsState: Buffer                 — encoded Y.Doc snapshot
└── currentVersion: int
    └── (audit) WorkspaceAction[]    — every applied action

Inside the Y.Doc, the shape depends on kind:

  kind=document:
    Y.XmlFragment "content"           — TipTap/ProseMirror
    Y.Map "comments"                  — id → {anchorBlockId, body, author}
    Y.Map "meta"                      — title, layout

  kind=sheet:
    Y.Array "sheets"                  — [{ id, name, rowCount, colCount }]
    Y.Map "cells"                     — "sheetId:row:col" → { value, formula?, format? }
    Y.Map "charts"                    — chartId → { sourceRange, type, ... }

  kind=slides:
    Y.Array "slides"                  — [{ id, layout, background }]
    Y.Map "elements"                  — "slideId:elementId" → { type, x, y, w, h, ... }
    Y.Map "theme"                     — palette, font, etc.
```

Every block / cell / element has a stable uuid. Yjs maintains the
ordering and concurrent-edit resolution.

---

## Action schema

A `WorkspaceAction` is the only legal way to mutate a workspace doc.
Defined as a Zod-validated discriminated union in
`src/shared/workspace-actions/`. Importable from frontend and backend.

### Universal envelope

```ts
type WorkspaceAction = {
  // Universal fields (every action has these)
  id: string;                 // uuid v4
  docId: string;              // target WorkspaceDoc.id
  actorKind: 'user' | 'coworker';
  actorUserId: string;        // human, even when actorKind=coworker
  coworkerId?: string | null; // when actorKind=coworker
  occurredAt: string;         // ISO8601
  // Discriminated payload
} & WorkspaceActionPayload;
```

### Document actions

| verb | payload | applies to |
|---|---|---|
| `doc.replace_content` | `{ tipTapJson }` | doc kind=document |
| `doc.insert_block` | `{ afterBlockId? \| atStart?: bool, block }` | document |
| `doc.update_block` | `{ blockId, patch }` | document |
| `doc.delete_block` | `{ blockId }` | document |
| `doc.add_comment` | `{ anchorBlockId, body }` | document |
| `doc.format_range` | `{ from, to, marks }` (ProseMirror coords) | document |

### Sheet actions

| verb | payload |
|---|---|
| `sheet.add_sheet` | `{ name, rowCount?, colCount? }` |
| `sheet.delete_sheet` | `{ sheetId }` |
| `sheet.set_cell` | `{ sheetId, row, col, value?, formula?, format? }` |
| `sheet.set_range` | `{ sheetId, fromRow, fromCol, rows: any[][] }` |
| `sheet.add_chart` | `{ sheetId, sourceRange, type }` |
| `sheet.sort` | `{ sheetId, column, direction }` |
| `sheet.filter` | `{ sheetId, column, predicate }` |

### Slide actions

| verb | payload |
|---|---|
| `slides.add_slide` | `{ afterSlideId?, layout?, background? }` |
| `slides.delete_slide` | `{ slideId }` |
| `slides.add_element` | `{ slideId, element }` (`element = {type, x, y, w, h, ...}`) |
| `slides.update_element` | `{ slideId, elementId, patch }` |
| `slides.move_element` | `{ slideId, elementId, x, y }` |
| `slides.delete_element` | `{ slideId, elementId }` |
| `slides.apply_theme` | `{ themeId }` |

### Doc-lifecycle actions

| verb | payload |
|---|---|
| `workspace.create_doc` | `{ kind, title, initial?: any }` |
| `workspace.rename_doc` | `{ title }` |
| `workspace.delete_doc` | `{}` |

The full list is enumerated authoritatively in
`src/shared/workspace-actions/index.ts`. Adding a new verb means:

1. Add to the union.
2. Implement the Yjs mutation in `WorkspaceActionService.apply()`.
3. Add a tool wrapper if the AI should be able to call it.

---

## Dispatch pipeline

```
                  ┌─────────────────────────┐
                  │  Coworker (LLM)         │
                  │  emits typed action     │
                  └─────────┬───────────────┘
                            │
                            │  office.dispatch_action tool
                            │
   ┌────────────────────────▼─────────────────────────┐
   │  Human user                                       │
   │  TipTap edit / cell change / slide drag           │
   │  produces same WorkspaceAction shape              │
   └────────────────────────┬─────────────────────────┘
                            │
                            ▼
       ┌──────────────────────────────────────────┐
       │  POST /v1/workspace/docs/:id/actions     │
       │  body: { action: WorkspaceAction }       │
       └──────────────────────┬───────────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │  WorkspaceActionService.apply(action)    │
       │   1. Zod-validate                        │
       │   2. ACL check (org / workspace / role)  │
       │   3. Load Y.Doc (cache or decode binary) │
       │   4. Mutate inside Y.Doc transaction     │
       │   5. Persist updated yjsState            │
       │   6. Append to actions audit log         │
       │   7. Broadcast to Hocuspocus subscribers │
       └──────────────────────┬───────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
       Connected browsers              Other AI agents
       (yjs CRDT updates)              (subscribe via API)
```

All write paths converge on the same service. There is no second way
to mutate a doc.

---

## Hocuspocus (realtime sync)

Phase 2 will add a Hocuspocus server (websocket) so connected clients
see each other's edits live. Three contracts:

1. **Auth.** The provider passes the user's JWT in the connect frame.
   Server verifies, attaches `{ userId, orgId }` to the connection,
   rejects unknown.
2. **Permissions.** On `onLoadDocument`, server confirms the user can
   read the target doc. On `onChange`, server validates that the
   incoming Yjs update only touches paths the user has write access
   to (read-only viewers reject the update).
3. **Persistence.** `onStoreDocument` debounces and persists the
   updated `yjsState` to Postgres.

The REST `dispatch_action` endpoint and the Hocuspocus server share
state via the same `WorkspaceActionService`. REST is for AI / scripted
mutations; Hocuspocus is for live user typing. Both end up writing
the same Y.Doc.

---

## Audit + history

Every applied action is appended to `workspace_action_log` (one row
per action). Columns: id, docId, actorKind, actorUserId, coworkerId,
verb, payload (jsonb), occurredAt.

`/v1/workspace/docs/:id/history?from=...&to=...` returns the action
list for a time range. Replaying actions from any base snapshot
produces the same doc — this is how "restore version" works.

Yjs has its own internal undo (UndoManager). The frontend wraps it
per-doc so ⌘Z behaves locally. Server-side audit log is the immutable
ground truth.

---

## AI surface

Three engine tools, all backed by `WorkspaceActionService`:

| tool | verbs it can dispatch |
|---|---|
| `office.create` | `workspace.create_doc` |
| `office.read` | (no mutation) — returns current state for a doc |
| `office.dispatch_action` | any of the action verbs above |

The Coworker plans like a person editing: "I'll create the doc, then
insert a heading, then insert a paragraph, then add a comment." Each
step is one action.

Higher-level tools (`office.create_doc_from_outline`, `office.export_records_to_sheet`) compose multiple actions in the
service layer for convenience — they're not magic, just batched
dispatches.

### Permission gating

Actions inherit the same `AccessControlService` checks as every other
Stack62 write. An action by a Coworker on behalf of a user is checked
against the intersection of (Coworker's role, user's role). A
Coworker with `editor` can never amplify a `viewer` user.

---

## What ships in turn 1 (this commit)

- `docs/AI_NATIVE_WORKSPACE.md` — this file.
- `src/shared/workspace-actions/` — Zod schema + TS types.
- `src/modules/workspace-state/`:
  - `WorkspaceDocEntity` (Yjs binary + metadata).
  - `WorkspaceActionLogEntity` (audit row per action).
  - `WorkspaceActionService` — apply/load/persist with full
    document-kind support.
  - REST controller exposing dispatch + read.
- Migration creating both tables.
- `office.dispatch_action` engine tool registered.
- No new npm dependencies. The Yjs encode/decode lives inline as a
  thin wrapper so we don't ship a half-installed library before the
  realtime turn.

---

## What does NOT ship in turn 1

- Yjs npm package + actual Y.Doc encoding (placeholder shape used).
- Hocuspocus server.
- TipTap-based frontend.
- AG Grid sheet editor.
- Konva slide editor.
- Realtime presence.
- DOCX/XLSX/PPTX import.

These are mapped to specific subsequent turns at the top of this doc.

---

## Open questions to resolve later

- **Yjs storage size.** We snapshot to Postgres bytea. For large
  docs this grows; we may want to GC the action log past N days and
  snapshot more aggressively.
- **AI throughput vs CRDT latency.** A Coworker dispatching 50
  actions in a row should batch into one Yjs transaction. Currently
  one-action-per-call. Revisit when AI agents start streaming.
- **Multi-tenant Hocuspocus.** Should we run one process per org or
  share? Initial answer: share, scoped by JWT.
- **Cross-doc references.** A sheet cell that references a system
  record (`=SYSTEM("Companies")`) needs a sync channel from system
  records → Y.Map cells. Open. Probably implemented as a server-
  side subscriber that re-evaluates and dispatches `sheet.set_cell`
  on record change.

---

## Why TipTap / AG Grid / Konva (and not custom)

Same question we asked for the existing in-house editors. The
honest answer:

- **TipTap/ProseMirror** is the only mature OSS rich-text editor
  with proper schema, transactions, and a y-prosemirror binding
  that doesn't fight Yjs. Notion uses ProseMirror. Google's editor
  is a custom (closed) JS layer over their own internal model.
- **AG Grid** is the spreadsheet for serious volume. It accepts a
  data source contract that maps cleanly to a Yjs Y.Map. Glide,
  Airtable, Coda all use AG Grid or an equivalent.
- **Konva** is the React-friendly canvas library; Fabric is fine
  too. Both let us drive a Y.Map scene graph from outside. Custom
  Canvas was tried in v1; the bug-to-feature ratio wasn't worth it.

These libraries are the right call once we know the action layer
is solid. Wiring them up before the state contract is set produces
exactly the mess we had before this rewrite.
