import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import {
  WorkspaceAction,
  WorkspaceActionEnvelopeSchema,
  WorkspaceActionInput,
  WorkspaceActionInputSchema,
  WorkspaceActionPayload,
  WorkspaceDocKind,
} from '../../shared/workspace-actions';
import { WorkspaceActionLogEntity } from './entities/workspace-action-log.entity';
import { WorkspaceDocEntity } from './entities/workspace-doc.entity';

interface DispatchActor {
  organizationId: string;
  workspaceId?: string | null;
  actorUserId: string;
  /** When the AI is acting on behalf of a user, this is set. */
  coworkerId?: string | null;
}

/**
 * The single mutation pipeline for every workspace doc (text doc,
 * spreadsheet, slide deck). Both human edits (via Yjs in browser)
 * and AI tool calls (via REST or directly via the engine) converge
 * here.
 *
 * Phase 1 implementation (this turn): the Y.Doc layer is represented
 * as a JSON blob inside `yjsState`. This works end-to-end and lets
 * the AI tool surface ship + be tested without Yjs npm dep churn.
 * Phase 2 swaps that JSON with real Y.Doc binary updates +
 * Hocuspocus broadcast. The service surface (the methods on this
 * class) does not change in phase 2 — only the implementation of
 * `applyToState()` becomes a real Yjs transaction.
 *
 * This is deliberately a "boring" service: validate, ACL-check,
 * mutate, persist, log. No event bus, no streams, no cleverness.
 * Cleverness goes on the layer above (the dispatcher decides if a
 * batch of actions should be coalesced; the Hocuspocus gateway
 * decides who to broadcast to). This service just applies.
 */
@Injectable()
export class WorkspaceStateService {
  private readonly logger = new Logger(WorkspaceStateService.name);

  constructor(
    @InjectRepository(WorkspaceDocEntity)
    private readonly docsRepo: Repository<WorkspaceDocEntity>,
    @InjectRepository(WorkspaceActionLogEntity)
    private readonly logRepo: Repository<WorkspaceActionLogEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  // ── Lookup ─────────────────────────────────────────────────────

  async findById(
    docId: string,
    actorUserId: string,
  ): Promise<WorkspaceDocEntity> {
    const doc = await this.docsRepo.findOne({ where: { id: docId } });
    if (!doc || doc.status === 'deleted') {
      throw new NotFoundException('Workspace doc not found.');
    }
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId: doc.organizationId,
      workspaceId: doc.workspaceId ?? undefined,
    });
    return doc;
  }

  async list(
    organizationId: string,
    actorUserId: string,
    opts: { workspaceId?: string; kind?: WorkspaceDocKind } = {},
  ): Promise<WorkspaceDocEntity[]> {
    const qb = this.docsRepo
      .createQueryBuilder('doc')
      .where('doc.status = :status', { status: 'active' });

    await this.accessControl.applyTenantScopeToQueryBuilder(
      qb,
      'doc',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId,
        workspaceId: opts.workspaceId,
      },
    );

    if (opts.kind) qb.andWhere('doc.kind = :kind', { kind: opts.kind });
    qb.orderBy('doc.updatedAt', 'DESC').limit(200);
    return qb.getMany();
  }

  // ── Dispatch ───────────────────────────────────────────────────

  /**
   * Apply a single action to its target doc. This is the only legal
   * entry point for mutating workspace state.
   *
   * Returns the action envelope (with id / occurredAt filled in)
   * plus the new `currentVersion` so callers can resync.
   */
  async dispatch(
    input: WorkspaceActionInput,
    actor: DispatchActor,
  ): Promise<{ action: WorkspaceAction; version: number }> {
    // 1. Validate the payload shape.
    const parsed = WorkspaceActionInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid action payload: ${parsed.error.message}`,
      );
    }
    const action = parsed.data;

    // 2. Special-case the doc-lifecycle verbs — these don't target an
    //    existing doc (create) or have different semantics (delete).
    if (action.verb === 'workspace.create_doc') {
      return this.handleCreateDoc(action, actor);
    }

    // 3. Otherwise load the target doc + ACL-check.
    const doc = await this.docsRepo.findOne({ where: { id: action.docId } });
    if (!doc || doc.status === 'deleted') {
      throw new NotFoundException('Workspace doc not found.');
    }
    await this.accessControl.assertResolvedAccess(actor.actorUserId, {
      resource: 'system',
      action: 'update',
      organizationId: doc.organizationId,
      workspaceId: doc.workspaceId ?? undefined,
    });

    // 4. Validate kind compatibility.
    this.assertVerbMatchesKind(action.verb, doc.kind);

    // 5. Mutate the encoded state. Phase 1: JSON blob inside
    //    `yjsState`. Phase 2: real Y.Doc transaction.
    const nextState = this.applyToState(doc, action);
    doc.yjsState = nextState;
    doc.currentVersion += 1;

    // 6. workspace.rename_doc and workspace.delete_doc shortcut here.
    if (action.verb === 'workspace.rename_doc') {
      doc.title = action.title;
    }
    if (action.verb === 'workspace.delete_doc') {
      doc.status = 'deleted';
    }

    await this.docsRepo.save(doc);

    // 7. Append to audit log.
    const envelope = this.envelope(action, doc.id, actor);
    await this.logRepo.save(
      this.logRepo.create({
        docId: doc.id,
        actorKind: envelope.actorKind,
        actorUserId: envelope.actorUserId,
        coworkerId: envelope.coworkerId ?? null,
        verb: envelope.verb,
        payload: stripEnvelope(envelope),
        occurredAt: new Date(envelope.occurredAt),
      }),
    );

    // 8. Activity (system-wide audit, separate from per-doc log).
    await this.activity.log({
      organizationId: doc.organizationId,
      workspaceId: doc.workspaceId,
      actorUserId: actor.actorUserId,
      action: `workspace.${envelope.verb}`,
      targetType: 'workspace_doc',
      targetId: doc.id,
      origin: actor.coworkerId ? 'ai' : 'user',
      metadata: { verb: envelope.verb },
    });

    return { action: envelope, version: doc.currentVersion };
  }

  // ── Create doc ─────────────────────────────────────────────────

  private async handleCreateDoc(
    action: WorkspaceActionInput,
    actor: DispatchActor,
  ): Promise<{ action: WorkspaceAction; version: number }> {
    if (action.verb !== 'workspace.create_doc') {
      throw new BadRequestException('Wrong handler for verb.');
    }
    await this.accessControl.assertResolvedAccess(actor.actorUserId, {
      resource: 'system',
      action: 'create',
      organizationId: actor.organizationId,
      workspaceId: actor.workspaceId ?? undefined,
    });
    const doc = await this.docsRepo.save(
      this.docsRepo.create({
        organizationId: actor.organizationId,
        workspaceId: actor.workspaceId ?? null,
        createdByUserId: actor.actorUserId,
        kind: action.kind,
        title: action.title,
        yjsState: this.initialState(action.kind, action.initial),
        currentVersion: 1,
        status: 'active',
        metadata: null,
      }),
    );
    const envelope = this.envelope(
      { ...action, docId: doc.id },
      doc.id,
      actor,
    );
    await this.logRepo.save(
      this.logRepo.create({
        docId: doc.id,
        actorKind: envelope.actorKind,
        actorUserId: envelope.actorUserId,
        coworkerId: envelope.coworkerId ?? null,
        verb: 'workspace.create_doc',
        payload: stripEnvelope(envelope),
        occurredAt: new Date(envelope.occurredAt),
      }),
    );
    await this.activity.log({
      organizationId: doc.organizationId,
      workspaceId: doc.workspaceId,
      actorUserId: actor.actorUserId,
      action: 'workspace.create_doc',
      targetType: 'workspace_doc',
      targetId: doc.id,
      origin: actor.coworkerId ? 'ai' : 'user',
      metadata: { kind: doc.kind, title: doc.title },
    });
    return { action: envelope, version: doc.currentVersion };
  }

  // ── State mutation ─────────────────────────────────────────────

  /**
   * Phase 1 stub. Decode the current state, apply the action to a
   * JSON shape, re-encode. Phase 2 will replace this with an actual
   * Y.Doc transaction (apply update bytes, encode update). The
   * boundaries (input action + output buffer) stay identical so
   * callers don't change.
   */
  private applyToState(
    doc: WorkspaceDocEntity,
    action: WorkspaceActionPayload,
  ): Buffer {
    const state = decodeState(doc.yjsState, doc.kind);
    applyActionToJsonState(state, action);
    return encodeState(state);
  }

  private initialState(
    kind: WorkspaceDocKind,
    initial: unknown,
  ): Buffer {
    const seed = makeInitialState(kind, initial);
    return encodeState(seed);
  }

  // ── Helpers ────────────────────────────────────────────────────

  private envelope(
    action: WorkspaceActionInput,
    docId: string,
    actor: DispatchActor,
  ): WorkspaceAction {
    const envelope = {
      ...action,
      id: randomUUID(),
      docId,
      actorKind: actor.coworkerId
        ? ('coworker' as const)
        : ('user' as const),
      actorUserId: actor.actorUserId,
      coworkerId: actor.coworkerId ?? null,
      occurredAt: new Date().toISOString(),
    } as WorkspaceAction;
    const parsed = WorkspaceActionEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new BadRequestException(
        `Action envelope invalid after enrichment: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  private assertVerbMatchesKind(verb: string, kind: WorkspaceDocKind) {
    if (verb.startsWith('workspace.')) return;
    if (verb.startsWith('doc.') && kind !== 'document') {
      throw new BadRequestException(
        `Action ${verb} requires a document; this doc is a ${kind}.`,
      );
    }
    if (verb.startsWith('sheet.') && kind !== 'sheet') {
      throw new BadRequestException(
        `Action ${verb} requires a sheet; this doc is a ${kind}.`,
      );
    }
    if (verb.startsWith('slides.') && kind !== 'slides') {
      throw new BadRequestException(
        `Action ${verb} requires slides; this doc is a ${kind}.`,
      );
    }
  }

  // ── Read state for clients ─────────────────────────────────────

  async readState(docId: string, actorUserId: string) {
    const doc = await this.findById(docId, actorUserId);
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      currentVersion: doc.currentVersion,
      state: decodeState(doc.yjsState, doc.kind),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async readActionLog(docId: string, actorUserId: string, limit = 100) {
    await this.findById(docId, actorUserId); // ACL check
    return this.logRepo.find({
      where: { docId },
      order: { occurredAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }
}

// ── Phase-1 JSON state (will be replaced by Y.Doc in phase 2) ─────

interface DocumentState {
  kind: 'document';
  /** TipTap doc JSON. The actual schema lives in the editor; here
   *  we just pass it through. */
  tipTapJson: unknown;
  blocks: Array<{ id: string; type: string; data: unknown }>;
  comments: Array<{
    id: string;
    anchorBlockId: string;
    body: string;
    authorUserId: string;
    createdAt: string;
  }>;
  meta: { title: string };
}

interface SheetState {
  kind: 'sheet';
  sheets: Array<{ id: string; name: string; rowCount: number; colCount: number }>;
  /** Key: `${sheetId}:${row}:${col}` */
  cells: Record<
    string,
    { value: unknown; formula?: string; format?: unknown }
  >;
  charts: Array<{ id: string; sheetId: string; sourceRange: string; type: string }>;
}

interface SlidesState {
  kind: 'slides';
  slides: Array<{ id: string; layout: string; background?: string }>;
  /** Key: `${slideId}:${elementId}` */
  elements: Record<string, Record<string, unknown>>;
  theme: { id: string };
}

type State = DocumentState | SheetState | SlidesState;

function encodeState(state: State): Buffer {
  return Buffer.from(JSON.stringify(state), 'utf8');
}

function decodeState(buf: Buffer, kind: WorkspaceDocKind): State {
  if (!buf || buf.length === 0) return makeInitialState(kind, undefined);
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as State;
    if (parsed.kind !== kind) {
      // shape drift — re-init rather than crash. Old kind metadata
      // is preserved in metadata column if needed.
      return makeInitialState(kind, undefined);
    }
    return parsed;
  } catch {
    return makeInitialState(kind, undefined);
  }
}

function makeInitialState(kind: WorkspaceDocKind, initial: unknown): State {
  if (kind === 'document') {
    return {
      kind: 'document',
      tipTapJson:
        initial ?? {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [],
            },
          ],
        },
      blocks: [],
      comments: [],
      meta: { title: '' },
    };
  }
  if (kind === 'sheet') {
    const sheetId = randomUUID();
    return {
      kind: 'sheet',
      sheets: [
        {
          id: sheetId,
          name: 'Sheet1',
          rowCount: 100,
          colCount: 26,
        },
      ],
      cells: {},
      charts: [],
    };
  }
  return {
    kind: 'slides',
    slides: [{ id: randomUUID(), layout: 'title' }],
    elements: {},
    theme: { id: 'default' },
  };
}

function applyActionToJsonState(state: State, action: WorkspaceActionPayload) {
  switch (action.verb) {
    // ── Doc lifecycle ──────────────────────────────────────────
    case 'workspace.rename_doc':
    case 'workspace.delete_doc':
      // Handled at the service level (title / status columns).
      return;
    case 'workspace.create_doc':
      // The create-doc path goes through handleCreateDoc; this branch
      // is unreachable but typescript wants the exhaustive switch.
      return;

    // ── Document verbs ─────────────────────────────────────────
    case 'doc.replace_content':
      if (state.kind !== 'document') return;
      state.tipTapJson = action.tipTapJson;
      return;
    case 'doc.insert_block':
      if (state.kind !== 'document') return;
      state.blocks.push({
        id: randomUUID(),
        type: action.block.type,
        data: action.block,
      });
      return;
    case 'doc.update_block':
      if (state.kind !== 'document') return;
      {
        const block = state.blocks.find((b) => b.id === action.blockId);
        if (block) block.data = { ...(block.data as object), ...action.patch };
      }
      return;
    case 'doc.delete_block':
      if (state.kind !== 'document') return;
      state.blocks = state.blocks.filter((b) => b.id !== action.blockId);
      return;
    case 'doc.add_comment':
      if (state.kind !== 'document') return;
      state.comments.push({
        id: randomUUID(),
        anchorBlockId: action.anchorBlockId,
        body: action.body,
        authorUserId: 'unknown', // filled by the dispatcher in phase 2
        createdAt: new Date().toISOString(),
      });
      return;
    case 'doc.format_range':
      // Format ranges are ProseMirror-coord changes; phase 1 stub
      // just records they happened. Real semantics arrive with
      // y-prosemirror in phase 2.
      return;

    // ── Sheet verbs ─────────────────────────────────────────────
    case 'sheet.add_sheet':
      if (state.kind !== 'sheet') return;
      state.sheets.push({
        id: randomUUID(),
        name: action.name,
        rowCount: action.rowCount ?? 100,
        colCount: action.colCount ?? 26,
      });
      return;
    case 'sheet.delete_sheet':
      if (state.kind !== 'sheet') return;
      state.sheets = state.sheets.filter((s) => s.id !== action.sheetId);
      return;
    case 'sheet.set_cell':
      if (state.kind !== 'sheet') return;
      state.cells[`${action.sheetId}:${action.row}:${action.col}`] = {
        value: action.value ?? null,
        formula: action.formula,
        format: action.format,
      };
      return;
    case 'sheet.set_range':
      if (state.kind !== 'sheet') return;
      action.rows.forEach((row, ri) => {
        row.forEach((value, ci) => {
          state.cells[
            `${action.sheetId}:${action.fromRow + ri}:${action.fromCol + ci}`
          ] = { value };
        });
      });
      return;
    case 'sheet.add_chart':
      if (state.kind !== 'sheet') return;
      state.charts.push({
        id: randomUUID(),
        sheetId: action.sheetId,
        sourceRange: action.sourceRange,
        type: action.type,
      });
      return;
    case 'sheet.sort':
    case 'sheet.filter':
      // Sort + filter are view-level operations; the cell map
      // doesn't change, just the rendering order. The editor handles
      // them locally; we record them for audit but don't mutate
      // cells.
      return;

    // ── Slides verbs ────────────────────────────────────────────
    case 'slides.add_slide':
      if (state.kind !== 'slides') return;
      {
        const newSlide = {
          id: randomUUID(),
          layout: action.layout ?? 'blank',
          background: action.background,
        };
        if (action.afterSlideId) {
          const idx = state.slides.findIndex(
            (s) => s.id === action.afterSlideId,
          );
          state.slides.splice(idx + 1, 0, newSlide);
        } else {
          state.slides.push(newSlide);
        }
      }
      return;
    case 'slides.delete_slide':
      if (state.kind !== 'slides') return;
      state.slides = state.slides.filter((s) => s.id !== action.slideId);
      Object.keys(state.elements)
        .filter((k) => k.startsWith(`${action.slideId}:`))
        .forEach((k) => delete state.elements[k]);
      return;
    case 'slides.add_element':
      if (state.kind !== 'slides') return;
      {
        const elementId = action.element.id ?? randomUUID();
        state.elements[`${action.slideId}:${elementId}`] = {
          ...action.element,
          id: elementId,
        };
      }
      return;
    case 'slides.update_element':
      if (state.kind !== 'slides') return;
      {
        const key = `${action.slideId}:${action.elementId}`;
        if (state.elements[key]) {
          state.elements[key] = { ...state.elements[key], ...action.patch };
        }
      }
      return;
    case 'slides.move_element':
      if (state.kind !== 'slides') return;
      {
        const key = `${action.slideId}:${action.elementId}`;
        if (state.elements[key]) {
          state.elements[key] = {
            ...state.elements[key],
            x: action.x,
            y: action.y,
          };
        }
      }
      return;
    case 'slides.delete_element':
      if (state.kind !== 'slides') return;
      delete state.elements[`${action.slideId}:${action.elementId}`];
      return;
    case 'slides.apply_theme':
      if (state.kind !== 'slides') return;
      state.theme = { id: action.themeId };
      return;
  }
}

function stripEnvelope(action: WorkspaceAction): WorkspaceActionPayload {
  const {
    id: _id,
    docId: _docId,
    actorKind: _actorKind,
    actorUserId: _actorUserId,
    coworkerId: _coworkerId,
    occurredAt: _occurredAt,
    ...payload
  } = action;
  return payload as WorkspaceActionPayload;
}
