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
import { OpenRouterService } from '../ai/openrouter.service';
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
import {
  applyActionToDoc,
  decodeDoc,
  encodeDoc,
  extractPlainText,
  makeFreshDoc,
  snapshotDoc,
} from './yjs-state';

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
    private readonly openRouter: OpenRouterService,
  ) {}

  /** Doc ids currently being auto-titled, so a burst of saves doesn't
   *  fire several LLM title requests for the same untitled doc. */
  private readonly titlingInFlight = new Set<string>();

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
    const envelope = this.envelope({ ...action, docId: doc.id }, doc.id, actor);
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
   * Phase 2 (turn 2): real Y.Doc transaction. We decode the persisted
   * Yjs update bytes into a fresh Y.Doc, apply the action inside a
   * `doc.transact()` (so observers see one atomic change rather than
   * a partial state), and re-encode the whole thing back to bytes.
   *
   * Once Hocuspocus is up, this same Y.Doc state is what gets
   * broadcast to connected browsers. The service stays the only path
   * that writes; Hocuspocus is the channel.
   */
  private applyToState(
    doc: WorkspaceDocEntity,
    action: WorkspaceActionPayload,
  ): Buffer {
    const yDoc = decodeDoc(doc.yjsState);
    applyActionToDoc(yDoc, action, doc.kind);
    return encodeDoc(yDoc);
  }

  private initialState(kind: WorkspaceDocKind, initial: unknown): Buffer {
    return encodeDoc(makeFreshDoc(kind, initial));
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
      actorKind: actor.coworkerId ? ('coworker' as const) : ('user' as const),
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
    const yDoc = decodeDoc(doc.yjsState);
    return {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      currentVersion: doc.currentVersion,
      state: snapshotDoc(yDoc, doc.kind),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Read the raw Yjs binary state. Used by the Hocuspocus server's
   * `onLoadDocument` hook to hydrate a fresh Y.Doc when a client
   * connects without an existing in-memory copy.
   */
  async readBinaryState(
    docId: string,
    actorUserId: string,
  ): Promise<{ doc: WorkspaceDocEntity; bytes: Buffer }> {
    const doc = await this.findById(docId, actorUserId);
    return { doc, bytes: doc.yjsState };
  }

  /**
   * Persist a Yjs binary update arriving from Hocuspocus. Called by
   * the `onStoreDocument` hook after debounce. The caller already
   * holds the merged Y.Doc and gives us the canonical bytes; we
   * just persist and bump the version counter.
   */
  async persistBinaryState(
    docId: string,
    bytes: Uint8Array,
    actorUserId: string,
  ): Promise<void> {
    const doc = await this.findById(docId, actorUserId);
    doc.yjsState = Buffer.from(bytes);
    doc.currentVersion += 1;

    // Google Docs-style auto-title: if the user never named the file,
    // read what they've written and give it a meaningful title. This
    // is best-effort and must never break autosave — any failure just
    // leaves the placeholder title in place for the next save to retry.
    if (
      this.isPlaceholderTitle(doc.title) &&
      !this.titlingInFlight.has(docId)
    ) {
      this.titlingInFlight.add(docId);
      try {
        const title = await this.deriveAutoTitle(doc);
        // Re-check the placeholder in case a concurrent rename landed.
        if (title && this.isPlaceholderTitle(doc.title)) {
          doc.title = title;
        }
      } catch (err) {
        this.logger.warn(
          `Auto-title failed for ${docId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        this.titlingInFlight.delete(docId);
      }
    }

    await this.docsRepo.save(doc);
  }

  // ── Auto-title (untitled, Google Docs-style) ───────────────────────

  /** True when the title is empty or still a generic "Untitled …". */
  private isPlaceholderTitle(title: string | null | undefined): boolean {
    if (!title) return true;
    return /^untitled\b/i.test(title.trim());
  }

  /**
   * Derive a short, meaningful title from the doc's current content.
   * Tries the coworker (LLM) first so the title reflects what the
   * document *means*, and falls back to the first meaningful line of
   * text when AI isn't configured or errors out.
   *
   * Returns null when there isn't enough content to title yet (e.g. a
   * brand-new empty doc) — we keep the placeholder until the user has
   * actually written something.
   */
  private async deriveAutoTitle(
    doc: WorkspaceDocEntity,
  ): Promise<string | null> {
    const text = extractPlainText(decodeDoc(doc.yjsState), doc.kind);
    if (text.trim().length < 6) return null;

    // 1) Ask the coworker to name it from the meaning of the content.
    //    Bounded by a timeout so a slow/hung model never stalls the
    //    autosave path — we just fall back to the first-line title.
    try {
      const completion = this.openRouter.complete([
        {
          role: 'system',
          content:
            'You name documents. Read the content and reply with ONLY a short, ' +
            'descriptive title (3 to 8 words, no surrounding quotes, no trailing ' +
            'punctuation). Do not explain.',
        },
        {
          role: 'user',
          content: `Suggest a title for this ${doc.kind}:\n\n${text.slice(0, 1500)}`,
        },
      ]);
      const raw = await Promise.race([
        completion,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      const cleaned = this.cleanTitle(raw);
      if (cleaned) return cleaned;
    } catch (err) {
      this.logger.warn(
        `LLM titling unavailable, using first-line fallback: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // 2) Fallback: first meaningful line, trimmed to a sensible length.
    return this.cleanTitle(text.split(/[\n.!?]/)[0] ?? text);
  }

  /**
   * Normalise an LLM/first-line title candidate: strip quotes, code
   * fences, and the "[AI disabled …]" sentinel, collapse whitespace,
   * and cap the length at a word boundary. Returns null when nothing
   * usable remains.
   */
  private cleanTitle(candidate: string | null | undefined): string | null {
    if (!candidate) return null;
    let title = candidate
      .replace(/\[AI disabled[^\]]*\]/gi, '')
      .replace(/^["'`\s]+|["'`\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return null;
    const MAX = 80;
    if (title.length > MAX) {
      const cut = title.slice(0, MAX);
      const lastSpace = cut.lastIndexOf(' ');
      title = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
    }
    return title || null;
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
