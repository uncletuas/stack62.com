# Stack62 implementation backlog

Every deferred item I've called out across the build, with enough
detail that any contributor (human or AI) can pick one up and execute
without going back and re-thinking the design. Each item lists files
to touch, key decisions with rationale, a concrete step-by-step, the
test plan, and an honest scope estimate.

Order is rough priority — top items unblock the most user-visible
gaps. Reorder freely.

---

## Status legend

- **Spec**: design done, ready to implement.
- **Open question**: a decision worth surfacing before code.
- **Out of scope**: noted so we stop re-litigating it; don't build.

Items are organised by area: **office suite**, **engine**, **infra**,
**product**.

---

# Office suite

## 1. Undo / redo on sheet + slides surfaces

**Status**: Spec.

**Goal**: ⌘Z / ⌘⇧Z on `WorkspaceSheetSurface` and `WorkspaceSlidesSurface`
undoes the last action the local user dispatched (their own, never
someone else's), through the same audit pipeline as a fresh edit.

**Why not Y.UndoManager directly**: The standard `Y.UndoManager` watches
a Y.Doc and emits inverse Yjs updates. That works when the user's
edits *are* the Yjs writes (the TipTap docs case). On sheets/slides
we dispatch through REST → backend writes the Y.Doc → broadcast back.
A client-side `Y.UndoManager` undo would re-apply the inverse Yjs
update *locally* without going through `WorkspaceStateService.dispatch`
— bypassing ACL, audit, and the Coworker-visible action history. Not
acceptable.

**Approach: inverse-action dispatch.** Each verb has a known inverse:

| Forward verb | Inverse |
|---|---|
| `sheet.set_cell` value=v new, formula=f new | `sheet.set_cell` with the previous {value, formula, format} captured at dispatch time |
| `sheet.set_range` | `sheet.set_range` with the previous 2D array |
| `sheet.add_sheet` | `sheet.delete_sheet` |
| `sheet.delete_sheet` | `sheet.add_sheet` + replay every `sheet.set_cell` for that sheet |
| `slides.add_slide` | `slides.delete_slide` |
| `slides.delete_slide` | re-create slide + re-create every element |
| `slides.add_element` | `slides.delete_element` |
| `slides.update_element` | `slides.update_element` with prior patch values |
| `slides.move_element` | `slides.move_element` to prior x/y |
| `slides.delete_element` | `slides.add_element` (restoring the prior shape) |

**Files to touch**:
- `src/shared/workspace-actions/index.ts` — no schema change, but
  document the inverse semantics in a JSDoc block per verb.
- `src/modules/workspace-state/workspace-state.service.ts` —
  `dispatch()` already returns the action envelope; extend the
  return to include the prior-state snapshot of mutated keys so the
  client can build the inverse without re-reading. Shape:
  `{ action, version, inverse?: WorkspaceActionInput | null }`.
  Compute `inverse` *before* applying the mutation, from the current
  `yDoc` state. `sheet.delete_sheet` returns null because the inverse
  is multi-action — handle that separately client-side.
- `Stack62_design/src/app/workspace/editors/workspace-surfaces/`
  add `useUndoStack.ts` — a small hook that maintains a per-doc undo
  stack of `{ inverse }` entries (cap at 50) and a redo stack. Each
  `dispatchWorkspaceAction` call from these surfaces routes through
  the hook so the inverse lands on the stack. `⌘Z` pops the undo
  stack, dispatches the inverse, pushes onto redo. `⌘⇧Z` mirrors.
- Both surface files: wire keyboard listeners, replace direct
  `dispatchWorkspaceAction` calls with the hook.

**Test plan**:
- Type "1" into A1, ⌘Z → A1 returns to empty. ⌘⇧Z → A1 becomes 1.
- Drag a slide element from (0,0) to (200,200), ⌘Z → element returns
  to (0,0).
- Two browsers: user A undoes their cell edit. User B's cell, edited
  separately, is unaffected.
- Verify the audit log shows both the original and inverse action
  rows — undo is itself an event, not a redaction.

**Edge cases**:
- AI dispatches an action while a user has it in their undo stack.
  The inverse becomes stale. Decision: still dispatch the inverse;
  if it conflicts (target cell now empty, target element now
  deleted), the server returns gracefully (the existing
  `applyActionToDoc` is no-op on missing targets). The undo just
  has no visible effect — accept that and log it.
- Undo stack survives tab close? No — in-memory only. Persistent
  per-user undo is out of scope; users say "ask the Coworker to
  revert" for cross-session undo.

**Scope**: 1 focused turn. ~300 lines + tests.

---

## 2. Comments + suggestions mode

**Status**: Spec.

**Goal**: TipTap document comments backed by `doc.add_comment` action
+ a sidebar that lists open comments. Phase 2: suggestions mode where
edits are proposed not applied.

**Phase 2.1 — comments**

**Files to touch**:
- `Stack62_design/src/app/workspace/editors/workspace-surfaces/`
  - `WorkspaceDocSurface.tsx` (extract from `WorkspaceDocEditor` first):
    add a TipTap `Comment` mark extension that wraps the selected
    range with a span carrying `commentId`. On apply, dispatch
    `doc.add_comment` with `{ anchorBlockId, body }`.
  - `WorkspaceCommentsPanel.tsx` (new): reads Y.Map("comments")
    snapshot, renders one card per open comment, click → scroll the
    editor to the anchor.
- `src/modules/workspace-state/yjs-state.ts` — `applyActionToDoc`
  for `doc.add_comment` already writes to `Y.Map("comments")`; just
  make sure the comment record stores the editor *range* not just
  the block id (since TipTap selections are ranged). Schema patch:
  payload becomes `{ anchorRange: { from: number; to: number }, body }`.
- `src/shared/workspace-actions/index.ts` — update DocAddCommentSchema.

**Phase 2.2 — suggestions mode (defer)**

Genuine track-changes is a different beast — every edit is staged in
a "suggestion" container that another user (or the original author)
accepts/rejects before it lands. ProseMirror has `prosemirror-changeset`
that handles this. Add when phase 2.1 lands and we measure the demand.

**Test plan**:
- Select text, type ⌘⌥M, type a comment body, hit save → mark appears
  on the range, comment row appears in the sidebar.
- Open in second browser, comment is visible.
- Click the comment in the sidebar → editor scrolls + highlights the
  range.
- Resolve a comment → mark removed, row leaves the sidebar (the
  `doc.add_comment` schema is currently insert-only; add
  `doc.resolve_comment` + `doc.delete_comment` verbs).

**Scope**: 1 turn for 2.1. 2.2 is a separate 2-turn project.

---

## 3. Image upload in slides + docs

**Status**: Spec.

**Goal**: User drags an image onto a slide canvas (or doc) → image
appears + becomes an addressable element in the Y.Doc.

**Files to touch**:
- Backend, new endpoint
  `POST /v1/workspace/docs/:docId/assets`. Accepts multipart upload,
  stores via `FilesService.upload` with `scope='document'`, returns
  `{ fileId, downloadUrl }`. Auth: same ACL as the doc itself
  (`update`).
- `src/modules/engine/tools/office.tools.ts` — new tool
  `office.upload_asset_to_workspace_doc` so the Coworker can attach
  an image found in chat or generated via a future image-gen tool.
- Frontend
  `WorkspaceSlidesSurface.tsx`:
  - Toolbar gets a "Add image" button → opens file picker → uploads via
    the new endpoint → dispatches `slides.add_element` with
    `{ type: 'image', src: downloadUrl, x, y, w, h }`.
  - Konva `Image` component renders elements with `type==='image'`
    using the `use-image` hook (lightweight, MIT licensed) or a
    hand-rolled `<img>`-to-`HTMLImageElement` loader.
  - Drag-drop on the canvas surface: handle `onDrop` with files,
    upload, insert as an element at the drop coords.
- `WorkspaceDocSurface.tsx` (once extracted): TipTap `Image`
  extension wired so drag/paste of an image triggers the same
  upload endpoint, then `editor.commands.setImage({ src })`.

**Schema patch**: `slides.add_element` already accepts `type: 'image'`
in the Zod schema (see `slideElementSchema.src` field). No change
needed.

**Open question**: where to store image binaries — same `files` table
(`scope='document'`) so existing share/delete/audit paths work? Yes.
Decision: reuse `FilesService.upload`. New endpoint is just a thin
wrapper that hard-codes `ownerKind='workspace-doc'` and validates the
target doc id.

**Test plan**:
- Drag a 2MB PNG onto a slide → uploads, appears on the canvas,
  selectable + draggable.
- Open in second browser → same image renders.
- Delete the slide → image element + the underlying file row stay
  (we don't garbage-collect orphan files; that's a separate concern
  tracked as "file orphan GC" below).

**Scope**: 1 turn for slides, 1 turn for docs. Can land together.

---

## 4. Charts in sheets

**Status**: Spec.

**Goal**: Right-click a range → "Insert chart" → chart appears on
the sheet referencing that range. The chart re-renders when the
referenced cells change.

**Files to touch**:
- Frontend: pick a chart library. Recommended:
  [Recharts](https://recharts.org) — already a dep (`recharts: 2.15.2`
  in `package.json`). MIT, React-native, lightweight.
- `WorkspaceSheetSurface.tsx`:
  - Add a "Insert chart" item to the right-click cell menu (need to
    add a context menu first — AG Grid has built-in `contextMenuItems`
    but is enterprise; we'd implement a custom menu).
  - On insert, dispatch `sheet.add_chart` with
    `{ sheetId, sourceRange: 'A1:C10', type: 'line' }`.
  - New `<ChartLayer />` component that reads `Y.Map("charts")` and
    renders an overlaid `<ResponsiveContainer>` per chart, computing
    data from the source range live (i.e. it observes the cells Y.Map
    and recomputes when referenced cells change).
- Action verb `sheet.add_chart` is already defined. Add
  `sheet.update_chart` and `sheet.delete_chart` to support move +
  resize.

**Open question**: where does the chart *visually* live on the sheet?
- Option A: floating overlay rendered as a transparent layer on top
  of the AG Grid. Pro: easy to position. Con: scroll behaviour gets
  weird.
- Option B: dedicated "Charts" tab inside the workspace doc kind.
  Pro: clean separation. Con: doesn't match the user's mental model
  of "this chart belongs to this sheet".
- Recommendation: **A**, with snap-to-cell positioning so charts
  follow rows on scroll.

**Test plan**:
- Enter numbers in A1:A10, insert chart from that range, line chart
  appears.
- Type 999 into A5 → chart updates without page refresh.
- Open in two browsers — both see the same chart.

**Scope**: 1 turn for the basic line/bar/pie. 1 turn for pivot
charts + dashboards later.

---

## 5. PPTX import

**Status**: Open question → spec.

**Goal**: User uploads `.pptx` → workspace presentation appears with
slides + elements preserved.

**Why we deferred**: No good OSS Node.js parser. The contenders:
- `pptxgenjs` — write-only.
- `node-pptx-parser` — sparse, hasn't been touched in 18 months.
- `pptx2json` — yields the raw OOXML; we'd still need to walk it.

**Recommendation**: spawn a Python sidecar service that uses
`python-pptx` (mature, MIT). New `services/pptx-importer/` worker
along the lines of `services/meeting-bot/`. The Nest API POSTs the
binary to the worker over a private URL, gets back a structured JSON
matching our `slides.add_element` schema, then dispatches actions.

**Files to add**:
- `services/pptx-importer/Dockerfile` — Python 3.12 + `python-pptx`.
- `services/pptx-importer/server.py` — FastAPI single-route POST
  `/parse` that accepts the .pptx and returns the JSON.
- `src/modules/workspace-state/workspace-import.service.ts` — add
  `importPptx()` that proxies to the sidecar via `fetch(env.PPTX_IMPORTER_URL)`.
- `src/modules/workspace-state/workspace-state.controller.ts` — extend
  the multipart upload handler to accept `.pptx` once the importer is
  configured (check `PPTX_IMPORTER_URL`; if unset, keep the existing
  "not yet supported" error).
- Update `office.import_file_to_workspace` engine tool to support
  pptx when the env is configured.

**Test plan**:
- Upload a 10-slide pptx → all 10 slides appear with their text +
  shape positions.
- Slides with embedded charts: text survives, chart shows as a
  placeholder image (export sidecar should pre-render charts to
  PNG and we add them as image elements).

**Scope**: 1 turn for the Node side. ½ turn for the Python sidecar.
Render deploy: new "Web Service" picking the Python Dockerfile.

---

## 6. Multi-sheet XLSX import

**Status**: Spec.

**Goal**: Importing a workbook with multiple worksheets creates one
workspace sheet with multiple tabs (matching Excel's structure), not
just the first.

**Files to touch**:
- `src/modules/workspace-state/workspace-import.service.ts:importXlsx()`:
  iterate `wb.worksheets`, build a `{ name, rows }` array.
- `src/modules/workspace-state/yjs-state.ts:makeFreshDoc` for `sheet`
  kind: accept `initial` as `Array<{ name, rows }>` (or fall back to
  the existing 2D-array shape for one-sheet imports). For each
  worksheet, push to `Y.Array("sheets")` and seed cells into
  `Y.Map("cells")` keyed by that sheet's id.
- Schema for `workspace.create_doc` already accepts `initial: unknown`
  — no schema change.

**Test plan**:
- Upload a 3-sheet xlsx → workspace sheet has 3 tabs at the bottom,
  click switches between them, cells are preserved per sheet.

**Scope**: ½ turn.

---

## 7. Slides `update_slide` verb (background changes)

**Status**: Spec.

**Goal**: Right now `slides.apply_theme` changes a theme key in the
Y.Map but there's no verb to change one slide's background colour.
The slide inspector's "Background" field is a stub.

**Files to touch**:
- `src/shared/workspace-actions/index.ts` — add `slides.update_slide`:
  `{ slideId: uuid, patch: Record<string, unknown> }`. Same shape as
  `slides.update_element`.
- `src/modules/workspace-state/yjs-state.ts:applyActionToDoc` — handle
  the new verb by patching the corresponding entry in `Y.Array("slides")`.
- `Stack62_design/src/app/workspace/editors/workspace-surfaces/WorkspaceSlidesSurface.tsx:SlideInspector` — wire the no-op
  `onUpdate` to dispatch `slides.update_slide`.

**Scope**: ¼ turn. Small enough to bundle with another change.

---

## 8. Sheet/Slides surface server-side rendering for TipTap inserts

**Status**: Open question → recommendation.

**Goal**: When the Coworker dispatches `doc.insert_block` server-side,
the resulting content should appear in the live TipTap editor without
the client needing to mount-then-parse.

**Current state**: We stash inserted blocks in a Y.Array("blocks")
shadow. The TipTap binding doesn't read that shadow — only the
Y.XmlFragment("content"). So AI inserts only show up if the client
specifically replays the blocks. That's why the existing
`WorkspaceDocSurface` (well, the inline TipTap UI in `WorkspaceDocEditor`)
doesn't actually surface the AI's inserted blocks.

**Approach**: Use TipTap's headless server runner with the same
extension set on the backend. After the action mutates the Y.Doc,
run a `getSchema()` → `Node.fromJSON(...)` → splice into the
XmlFragment via `prosemirrorJSONToYDoc` (from y-prosemirror). The
incantation:

```ts
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { Schema } from 'prosemirror-model';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';

const schema = new Schema({ /* same as client */ });
const node = schema.nodeFromJSON(tipTapJson);
const tempDoc = prosemirrorJSONToYDoc(schema, node.toJSON());
// merge tempDoc.content into our target Y.Doc's content fragment
```

**Files to touch**:
- New deps: `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm`,
  `prosemirror-model`, `prosemirror-schema-basic`, `y-prosemirror` on
  the backend. The first three plus y-prosemirror are heavy but the
  alternative is forking the editor schema, which is worse.
- `src/modules/workspace-state/yjs-state.ts`: replace the shadow
  `Y.Array("blocks")` path for document verbs with actual XmlFragment
  mutations.

**Open question**: is it cleaner to keep server-side TipTap or to
move ALL mutations client-side via Yjs (the AI ships an action, the
backend forwards it to a "Coworker presence" client that applies via
TipTap, then re-broadcasts)? The latter is closer to "everyone is
just a Yjs client" but harder to operate. **Recommendation**:
server-side TipTap. ~150 KB of node_modules; the bundle isn't shipped
to browsers.

**Test plan**:
- Coworker says `office.dispatch_action(doc.insert_block, ...)`.
- The change appears in the TipTap editor in the user's browser
  within 1 second.
- The change survives a page refresh (it's in the Y.XmlFragment, not
  a shadow).

**Scope**: 2 turns — non-trivial because the editor schema has to
stay in lockstep client + server.

---

## 9. File orphan GC

**Status**: Spec.

**Goal**: A workspace asset (image) uploaded to a doc that's later
deleted should not be retained in storage forever.

**Approach**: Daily BullMQ job that walks `files` rows with
`ownerKind='workspace-doc'`, checks the referenced doc is still
`status='active'`, and soft-deletes orphans. Hard-delete after a
30-day grace period.

**Files to add**:
- `src/modules/files/file-gc.processor.ts` — BullMQ processor.
- Add to `src/modules/jobs/jobs.module.ts` cron registration.

**Scope**: ¼ turn.

---

# Engine + Coworker

## 10. Schedule worker — schedules actually fire

**Status**: Spec (already documented in
`docs/SYSTEM_CAPABILITIES.md` as the highest priority gap).

**Goal**: A `schedules.create({ kind: 'reminder', startsAt: '4pm' })`
results in something actually happening at 4pm — a Coworker message,
an email, a workflow trigger.

**Files to add**:
- `services/schedule-worker/` along the lines of `services/meeting-bot/`.
  Node.js worker that polls the `schedules` table for rows where
  `nextFireAt <= now() AND status='scheduled'`. On each, look up the
  `metadata.action` (a `WorkspaceActionInput` shape — yes the same
  schema; we just chose well in turn 1) and dispatch it via
  `WorkspaceStateService.dispatch` OR if `kind='reminder'` post a
  message into the requester's coworker room.
- Add `nextFireAt` and `lastFiredAt` columns to `ScheduleEntity`.
- Migration.
- For RRULE handling, use `rrule.js` (MIT) to expand the rule and
  compute the next fire time.

**Files to touch**:
- `src/modules/engine/tools/schedules.tools.ts:schedules.create` — set
  `nextFireAt = startsAt` on create, store the action in metadata.
- Add `schedules.cancel` (already exists per `intent-classifier.ts`),
  ensure it sets `status='cancelled'` so the worker skips it.

**Scope**: 2 turns. New Render worker, new migration, new RRULE dep.

---

## 11. System templates catalogue

**Status**: Spec.

**Goal**: When the user says "build me a CRM", the Coworker doesn't
greenfield every entity — it clones the **CRM template** and
customises. Cuts plan size 5×.

**Files to add**:
- `src/shared/system-templates/` — TypeScript catalogue with one file
  per template. Each exports a `SystemDefinition` (using the canonical
  Zod shape). Recommended templates:
  - `crm.template.ts` — Companies, Contacts, Deals, Activities
  - `ats.template.ts` — Candidates, Roles, Interviews, Offers
  - `inventory.template.ts` — Products, Stock, Suppliers, Orders
  - `project-tracker.template.ts` — Projects, Tasks, Milestones, Time
  - `vendor-expenses.template.ts` — Vendors, Invoices, Approvals
- `src/modules/engine/tools/system.tools.ts` — new tool
  `systems.scaffold_from_template` that takes a template id and a
  name, instantiates a SystemDefinition (with new uuids), and pipes
  through `plans.propose`. The AI calls this *before* hand-rolling
  schemas.
- `src/modules/engine/engine.service.ts:BASE_PROMPT` — add: "If
  building a CRM, ATS, project tracker, inventory, or expense
  system, ALWAYS call systems.scaffold_from_template first and
  customise from there."

**Test plan**: "build a CRM with Pipedrive-style deal stages" should
produce a plan that re-uses the CRM template's entities and only
changes the Deal entity's status enum.

**Scope**: 1 turn for the catalogue + tool. Templates themselves are
~80 lines each.

---

## 12. Workflow validator + dry-run

**Status**: Spec.

**Goal**: A workflow definition (currently just a string `triggerType`
+ opaque `definition: object`) is validated before apply.

**Files to touch**:
- `src/shared/system-definition/system-definition.schema.ts` — tighten
  the workflow schema:
  ```ts
  workflows: z.array(z.object({
    triggerType: z.enum(['manual', 'webhook', 'schedule', 'record_changed']),
    triggerConfig: z.unknown(), // typed per triggerType
    steps: z.array(z.object({
      tool: z.string(),         // must exist in ToolRegistry
      input: z.record(z.string(), z.unknown()),
      condition: z.string().optional(),
    })),
  }))
  ```
- `src/modules/workflows/workflow-validator.service.ts` — new service
  that validates a workflow against the live `ToolRegistry` (refuse
  if `step.tool` doesn't resolve) + against the field shape (refuse
  if `triggerConfig` doesn't match `triggerType`).
- `src/modules/ai/plan-runner.service.ts` — call the validator before
  applying a plan that touches workflows.

**Scope**: 1 turn.

---

## 13. Live draft preview ("try before approve")

**Status**: Spec.

**Goal**: User reviews a plan that adds a new entity, clicks "preview"
→ the system shows what it'd look like with that change applied
in-memory, without committing.

**Approach**: A "draft mode" flag on `SystemDefinition` operations.
The runner accepts a SystemDefinition + a list of pending changes,
applies them in memory only (no migration, no record persistence),
and serves the resulting system over a temporary URL.

This is a meaty feature. Genuine implementation needs:
- `RunnerService` to accept a `draftId` parameter that scopes all
  reads/writes to an in-memory layer.
- Tab kind `draft-preview` that renders the modified system.
- A 1-hour TTL on draft contexts so we don't leak memory.

**Files to add**:
- `src/modules/runner/draft-context.service.ts`
- `src/modules/plans/plan-preview.controller.ts` — endpoints to
  start/stop a draft.
- Frontend: `PlanEditor` gets a "Preview" button that opens a new
  tab pointing at the draft URL.

**Scope**: 3 turns. The highest-trust feature on this list — worth
prioritising once we have customers.

---

## 14. Per-system permission policy enforcement

**Status**: Spec.

**Goal**: `permissionPolicies` on a SystemDefinition are stored and
displayed but not yet enforced beyond org/workspace ACL. A policy
like "Sales role can read Companies but only edit their own Deals"
needs the runtime to honour the role + field restrictions.

**Files to touch**:
- `src/shared/access-control/access-control.service.ts` — extend
  `assertResolvedAccess` to consume a `systemId` *and* an action
  *and* a record id; look up the matching `permissionPolicies` and
  evaluate them.
- A new helper `evaluatePolicy(policy, actor, record)` that interprets
  field restrictions + row conditions.
- `src/modules/records/records.service.ts` — all reads/writes
  funnel through the new helper.

**Scope**: 2 turns. The policy interpreter is the hard part.

---

## 15. AI cursor in collaborative editors

**Status**: Open question → recommendation.

**Goal**: When a Coworker dispatches an action targeting a doc, the
connected human users see a labelled "Coworker" cursor moving in
their editor — not just a "Coworker just edited" toast after the fact.

**Approach**: When `WorkspaceStateService.dispatch` finishes, if the
target doc has connected Hocuspocus clients, broadcast an awareness
update from a synthetic "Coworker presence" connection. Hocuspocus
exposes `server.openDirectConnection(docName)` for server-side actors.

**Files to touch**:
- `src/modules/workspace-state/workspace-realtime.service.ts` — add a
  method `notifyAiAction(docId, info)` that opens (or reuses) a
  Hocuspocus direct connection scoped to that doc, sets an awareness
  field `{ kind: 'coworker', name, color }`, then closes after a
  few seconds so the cursor fades.
- `WorkspaceStateService.dispatch` calls this after a successful
  apply, with the action verb + brief description.
- Frontend `CollaborationCursor` already renders peer cursors; the
  AI presence will show up automatically as another peer with its
  own name+colour.

**Test plan**: Coworker dispatches a `doc.insert_block`. A real-time
human user sees a green "Coworker" cursor appear at the insertion
point, the block shows, the cursor fades.

**Scope**: 1 turn.

---

## 16. Cross-doc references (formulas pulling system records)

**Status**: Spec.

**Goal**: A sheet cell with `=SYSTEM("Companies", "name")` returns
the live value from a record in an AI-built system. Lets users
build dashboards directly in sheets.

**Approach**: Extend the formula evaluator with a `SYSTEM(table, field)`
function. Server-side, on `sheet.set_cell` with such a formula, the
service subscribes the cell to the source records (via Postgres LISTEN
on `record.updated` notifications) and re-evaluates → dispatches a
follow-up `sheet.set_cell` whenever the underlying record changes.

**Files to touch**:
- `Stack62_design/src/app/workspace/editors/workspace-surfaces/WorkspaceSheetSurface.tsx`
  — extend `applyFunction` to handle `SYSTEM`.
- Backend: `src/modules/workspace-state/record-binding.service.ts` —
  subscribes to record events, evaluates pending formulas, dispatches
  cell updates.
- Add `record_subscription` table to track which cells depend on
  which records.

**Scope**: 3 turns. The dependency graph is the gnarly bit.

---

## 17. Suggesting mode for documents

**Status**: Spec (the "phase 2.2" of item 2).

**Goal**: Edits made while "suggesting" is on are staged as
suggestions; another user accepts/rejects.

**Approach**: Use `prosemirror-changeset`. Every edit while in
suggesting mode wraps in a `<span class="suggestion"
data-author="userId">`. Acceptance applies normally; rejection
removes the wrapper.

**Files to touch**:
- TipTap custom Suggestion mark extension.
- Sidebar that lists open suggestions with accept/reject buttons.
- Two new action verbs: `doc.accept_suggestion(suggestionId)` and
  `doc.reject_suggestion(suggestionId)`.

**Scope**: 2 turns.

---

# Infrastructure

## 18. Render WebSocket support verification

**Status**: Spec.

**Goal**: After the next deploy, confirm Hocuspocus actually works
in production. Open the workspace doc, watch the network tab for
`wss://stack62.com/v1/realtime/workspace` upgrading 101, watch the
status pill flip to Live.

**If it doesn't work**:
- Render has WebSocket on by default for Web Services.
- Cloudflare or any proxy in front needs WebSocket support enabled.
- Check `NestFactory.create()` is using the default http adapter
  (Express); Fastify needs a different `@hocuspocus/transformer`
  binding.

**Scope**: 1 hour of manual verification + remediation.

---

## 19. Bundle-size split for the workspace editor

**Status**: Spec.

**Goal**: `WorkspaceDocEditor` is currently 1.96 MB / 576 KB gzipped
(it includes TipTap + AG Grid + Konva). Lazy-load each surface
separately so opening a workspace doc only downloads the relevant
~600 KB.

**Files to touch**:
- `WorkspaceDocEditor.tsx` — replace the static surface imports with
  `lazy(() => import(...))`. The router already exists; just split
  the import points.

**Scope**: ½ turn.

---

## 20. Audit log retention + Y.Doc snapshot GC

**Status**: Open question.

**Goal**: `workspace_action_log` and `workspace_docs.yjs_state` grow
forever right now. We need a policy.

**Approach**:
- `workspace_action_log` past 90 days → archived to S3, removed
  from Postgres. Audit queries falling back to S3 when needed.
- `workspace_docs.yjs_state` — Yjs's "garbage collection" (which is
  on by default) keeps removed tombstones. We can call `Y.encodeStateAsUpdate`
  with `garbageCollector: true` to flatten and re-encode.

**Open question**: do compliance requirements (the SOC 2 readiness
doc) say audit logs must be retained for N years? Need to confirm
before setting the 90-day window.

**Scope**: 1 turn after the open question resolves.

---

# Product surface

## 21. Realtime voice silence-after-first-reply: long-term

**Status**: Already fixed (commit `99f06e4`) but: the workaround
(`create_response: true` explicit + defer frames during in-flight
response) is conservative. A more robust fix:
- Drop video frames entirely when they'd interfere — use the
  realtime *audio* alone plus an out-of-band screen-share track if
  the user wants vision.
- Or use OpenAI's newer "auto" turn detection mode that handles
  multi-modal context more gracefully.

**Scope**: ½ turn. Worth doing once we have evidence the workaround
is leaking.

---

## 22. Notifications backend

**Status**: The Notifications settings panel is a local-only stub.

**Goal**: User preferences sync across devices. Backend sends emails
+ in-app toasts based on those preferences.

**Files to add**:
- `notification_preferences` table on the user.
- `src/modules/notifications/` module.
- Triggers: mentions in rooms/comments, plan approvals, etc.

**Scope**: 2 turns.

---

## 23. Billing service

**Status**: The Billing settings panel correctly says "in preview".

**Goal**: Stripe-backed metered billing.

**Decisions to lock first**:
- Per-user-seat or per-Coworker-message?
- Free tier limits?
- Annual vs monthly toggle?

Best done as a separate epic when there's revenue to attribute.

**Scope**: 3 turns + product decisions.

---

## 24. 2FA + per-device sessions

**Status**: Marked "coming soon" in the Security settings panel.

**Goal**: TOTP-based 2FA + a `user_sessions` table so we can show
"signed in on: Mac • Chrome • 2h ago" and offer remote sign-out.

**Files to add**:
- `user_sessions` table with `userId`, `createdAt`, `lastSeenAt`,
  `userAgent`, `ip`, `revokedAt`.
- TOTP setup flow using `otplib` (no native deps, BSD).
- Backend: `POST /account/2fa/enroll`, `POST /account/2fa/verify`,
  `POST /account/2fa/disable`.
- Sessions: `GET /account/sessions`, `POST /account/sessions/:id/revoke`.
- Frontend: replace the Security section "coming soon" buttons with
  the real flows.

**Scope**: 2 turns.

---

## 25. Onboarding flow polish

**Status**: Not explicitly deferred but worth scoping.

**Goal**: A new user's first 5 minutes leaves them with a working
demo system, a Coworker chat history, and at least one workspace doc.

**Approach**: Setup wizard that asks role + biggest pain (CRM, ATS,
inventory, etc.) → scaffolds from system template → seeds a workspace
doc with the playbook for that system → drops the user into a chat
with the Coworker.

**Scope**: 1 turn for the wizard. Depends on item 11 (templates).

---

# Decision log

A few choices that come up across multiple items, settled here once:

- **Action audit log is immutable.** Undo, redo, rollback, all create
  *new* audit rows. There is no deletion in the log.
- **Yjs binary is the canonical state.** All non-tabular shapes flow
  through Y.Doc. JSON fallback shapes are for HTTP consumers only.
- **AI talks through the action schema, not the UI.** No tool calls
  pixel automation. No UI simulation. Always typed actions on object
  ids.
- **Each verb's payload is validated at the boundary** (Zod inside
  `WorkspaceActionService.dispatch`). Anything that touches state
  must have a verb.
- **Inverse-action undo > Y.UndoManager** for non-document surfaces
  because it preserves the action audit + ACL invariants.

---

# Ordering recommendation

If you only ship 5 of these in the next month:

1. **Schedule worker (10)** — the biggest gap that the user
   notices directly; "I asked for a 4pm reminder and nothing happened".
2. **AI cursor (15)** — multiplies the "feels collaborative" sense
   the user is paying for.
3. **System templates (11)** — cuts plan size 5×, makes
   "build me a CRM" feel like 30 seconds not 5 minutes.
4. **Undo on sheet/slides (1)** — the missing ⌘Z is the loudest
   "this isn't a real editor" signal.
5. **Image upload in slides (3)** — slides without images are not
   pitch decks.

Comments, suggesting mode, charts, per-system permissions, billing,
2FA — all important, none unblocking. Sequence by demand once we have
users.
