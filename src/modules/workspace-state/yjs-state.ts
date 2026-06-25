/**
 * Yjs encoding for Stack62 workspace docs.
 *
 * Replaces the phase-1 JSON state with real Y.Doc binary state.
 * Storage shape on disk (`workspace_docs.yjs_state`) is now the
 * native Yjs encoded update — the bytes that `Y.encodeStateAsUpdate`
 * produces. We never store the in-memory Y.Doc directly; we round-trip
 * through `Y.applyUpdate` / `Y.encodeStateAsUpdate` to get a stable
 * persisted form.
 *
 * Why a fresh `Y.Doc` per dispatch (vs caching): action dispatch is
 * the slow REST/AI path. Caching belongs in the Hocuspocus layer
 * where live editing happens. For action dispatch we trade ~20ms of
 * Y.Doc construction for not having to manage a doc registry +
 * eviction policy.
 *
 * Schema per kind, inside the Y.Doc:
 *   document → Y.XmlFragment "content"  (TipTap binding compatible)
 *              Y.Map        "comments"  (id → {anchorBlockId,body,...})
 *              Y.Map        "meta"      (title)
 *   sheet    → Y.Array      "sheets"    [{id,name,rowCount,colCount}]
 *              Y.Map        "cells"     "sheetId:row:col" → {value,formula?,format?}
 *              Y.Map        "charts"    chartId → {...}
 *   slides   → Y.Array      "slides"    [{id,layout,background?}]
 *              Y.Map        "elements"  "slideId:elementId" → {...}
 *              Y.Map        "theme"     {id}
 *
 * These keys are also what y-prosemirror and y-tiptap bind to on the
 * client. The server-side mutations here have to agree with the
 * client bindings or you get split-brain documents.
 */

import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type {
  WorkspaceActionPayload,
  WorkspaceDocKind,
} from '../../shared/workspace-actions';

// ── Doc construction ──────────────────────────────────────────────

/**
 * Decode a stored Yjs update into a fresh Y.Doc. Returns an empty
 * Y.Doc when the buffer is empty or malformed (we'd rather give the
 * user an empty doc than crash; the action that just failed will
 * re-attempt against the empty doc).
 */
export function decodeDoc(buf: Buffer | null | undefined): Y.Doc {
  const doc = new Y.Doc();
  if (buf && buf.length > 0) {
    try {
      Y.applyUpdate(doc, new Uint8Array(buf));
    } catch {
      // Treat malformed bytes as empty rather than throwing — the
      // caller's action will write fresh state anyway.
    }
  }
  return doc;
}

/** Encode a Y.Doc as the canonical stored buffer. */
export function encodeDoc(doc: Y.Doc): Buffer {
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/**
 * Build a fresh Y.Doc seeded with the right top-level shapes for
 * this kind. The shapes have to exist before they can be referenced
 * by client-side bindings, even if empty.
 */
export function makeFreshDoc(kind: WorkspaceDocKind, initial: unknown): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    if (kind === 'document') {
      // y-prosemirror binds to a top-level XmlFragment by default
      // (key "prosemirror" or one we pass in via the binding). We
      // pre-create one with a known key so the client can bind
      // without an extra round-trip.
      doc.get('content', Y.XmlFragment);
      doc.getMap('comments');
      const meta = doc.getMap('meta');
      if (initial && typeof initial === 'object') {
        // initial may carry { title?: string, tipTapHtml?: string }
        const obj = initial as Record<string, unknown>;
        if (typeof obj.title === 'string') meta.set('title', obj.title);
        // TipTap initial content is set on the client when the
        // editor mounts (the server can't know the schema). The
        // server can stash the raw JSON for client to apply once:
        if (obj.tipTapJson) meta.set('initialTipTapJson', obj.tipTapJson);
      }
    } else if (kind === 'sheet') {
      const sheets = doc.getArray('sheets');
      sheets.push([
        {
          id: randomUUID(),
          name: 'Sheet1',
          rowCount: 200,
          colCount: 26,
        },
      ]);
      doc.getMap('cells');
      doc.getMap('charts');
      // Extended Google Sheets-parity state maps
      doc.getMap('merges');
      doc.getMap('freezes');
      doc.getMap('rowHeights');
      doc.getMap('colWidths');
      doc.getMap('conditionalFormats');
      doc.getMap('dataValidations');
      doc.getMap('namedRanges');
      if (Array.isArray(initial)) {
        const sheetId = (sheets.get(0) as { id: string }).id;
        const cells = doc.getMap('cells');
        (initial as unknown[][]).forEach((row, ri) => {
          row.forEach((value, ci) => {
            cells.set(`${sheetId}:${ri}:${ci}`, { value });
          });
        });
      }
    } else {
      const slides = doc.getArray('slides');
      const slideId = randomUUID();
      slides.push([{ id: slideId, layout: 'title' }]);
      doc.getMap('elements');
      doc.getMap('theme').set('id', 'default');
    }
  });
  return doc;
}

// ── Action → Y.Doc transaction ────────────────────────────────────

/**
 * Apply a workspace action inside a Y.Doc transaction. Mutates the
 * doc in place. Returns true if the action targeted shapes that
 * exist on this kind (i.e. the action was relevant); false when the
 * verb is for a different kind (the caller will already have refused
 * at validation, but we double-check here as defence-in-depth).
 *
 * Note: `doc.replace_content` is a TipTap-level operation. Server-
 * side we can't represent it through Y.XmlFragment mutations
 * without a ProseMirror schema, so we stash the new JSON in `meta`
 * under `pendingReplacement` — the client picks it up next time it
 * mounts. This is fine for AI-driven rewrites (the typical case);
 * real-time co-editing of rich text happens client-side anyway.
 */
export function applyActionToDoc(
  doc: Y.Doc,
  action: WorkspaceActionPayload,
  kind: WorkspaceDocKind,
): void {
  doc.transact(() => {
    switch (action.verb) {
      case 'workspace.rename_doc':
      case 'workspace.delete_doc':
      case 'workspace.create_doc':
        // Lifecycle — service handles these at the row level.
        return;

      // ── Document ────────────────────────────────────────────
      case 'doc.replace_content':
        if (kind !== 'document') return;
        doc.getMap('meta').set('pendingReplacement', action.tipTapJson);
        return;
      case 'doc.insert_block':
        if (kind !== 'document') return;
        // Until the client mounts and applies the TipTap binding,
        // we shadow inserts into a "blocks" array the client reads
        // and replays. Once y-prosemirror is wired, this branch will
        // build the ProseMirror node server-side via tiptap's
        // server-runner. For now this is the safe path.
        {
          const blocks = doc.getArray('blocks');
          blocks.push([
            {
              id: randomUUID(),
              ...action.block,
              afterBlockId: action.afterBlockId,
              atStart: !!action.atStart,
            },
          ]);
        }
        return;
      case 'doc.update_block':
        if (kind !== 'document') return;
        {
          const blocks = doc.getArray('blocks');
          for (let i = 0; i < blocks.length; i++) {
            const b = blocks.get(i) as { id?: string };
            if (b?.id === action.blockId) {
              blocks.delete(i, 1);
              blocks.insert(i, [{ ...(b as object), ...action.patch }]);
              break;
            }
          }
        }
        return;
      case 'doc.delete_block':
        if (kind !== 'document') return;
        {
          const blocks = doc.getArray('blocks');
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks.get(i) as { id?: string };
            if (b?.id === action.blockId) blocks.delete(i, 1);
          }
        }
        return;
      case 'doc.add_comment':
        if (kind !== 'document') return;
        {
          const id = randomUUID();
          doc.getMap('comments').set(id, {
            id,
            anchorBlockId: action.anchorBlockId,
            body: action.body,
            createdAt: new Date().toISOString(),
          });
        }
        return;
      case 'doc.format_range':
        if (kind !== 'document') return;
        // Format ranges happen at the ProseMirror level inside the
        // client. We log them; the action log is the source of truth.
        return;

      // ── Sheet ───────────────────────────────────────────────
      case 'sheet.add_sheet':
        if (kind !== 'sheet') return;
        // Ensure extended maps exist
        doc.getMap('merges');
        doc.getMap('freezes');
        doc.getMap('rowHeights');
        doc.getMap('colWidths');
        doc.getMap('conditionalFormats');
        doc.getMap('dataValidations');
        doc.getMap('namedRanges');
        doc.getArray('sheets').push([
          {
            id: randomUUID(),
            name: action.name,
            rowCount: action.rowCount ?? 200,
            colCount: action.colCount ?? 26,
          },
        ]);
        return;
      case 'sheet.delete_sheet':
        if (kind !== 'sheet') return;
        {
          const arr = doc.getArray('sheets');
          for (let i = arr.length - 1; i >= 0; i--) {
            const s = arr.get(i) as { id?: string };
            if (s?.id === action.sheetId) arr.delete(i, 1);
          }
          // Also strip cells targeting this sheet.
          const cells = doc.getMap('cells');
          for (const key of Array.from(cells.keys())) {
            if (key.startsWith(`${action.sheetId}:`)) cells.delete(key);
          }
        }
        return;
      case 'sheet.rename_sheet':
        if (kind !== 'sheet') return;
        {
          const arr = doc.getArray('sheets');
          for (let i = 0; i < arr.length; i++) {
            const s = arr.get(i) as { id?: string; name?: string };
            if (s?.id === action.sheetId) {
              arr.delete(i, 1);
              arr.insert(i, [{ ...s, name: action.name }]);
              break;
            }
          }
        }
        return;
      case 'sheet.set_cell':
        if (kind !== 'sheet') return;
        doc
          .getMap('cells')
          .set(`${action.sheetId}:${action.row}:${action.col}`, {
            value: action.value ?? null,
            formula: action.formula,
            format: action.format,
          });
        return;
      case 'sheet.set_range':
        if (kind !== 'sheet') return;
        {
          const cells = doc.getMap('cells');
          action.rows.forEach((row, ri) => {
            row.forEach((value, ci) => {
              cells.set(
                `${action.sheetId}:${action.fromRow + ri}:${action.fromCol + ci}`,
                { value },
              );
            });
          });
        }
        return;
      case 'sheet.add_chart':
        if (kind !== 'sheet') return;
        {
          const chartId = randomUUID();
          doc.getMap('charts').set(chartId, {
            id: chartId,
            sheetId: action.sheetId,
            sourceRange: action.sourceRange,
            type: action.type,
            title: action.title,
          });
        }
        return;
      case 'sheet.update_chart':
        if (kind !== 'sheet') return;
        {
          const charts = doc.getMap('charts');
          const cur = charts.get(action.chartId);
          if (cur && typeof cur === 'object') {
            charts.set(action.chartId, { ...cur, ...action.patch });
          }
        }
        return;
      case 'sheet.delete_chart':
        if (kind !== 'sheet') return;
        doc.getMap('charts').delete(action.chartId);
        return;
      case 'sheet.sort':
      case 'sheet.filter':
        // View-level. Recorded in the action log only.
        return;

      case 'sheet.add_row':
        if (kind !== 'sheet') return;
        {
          // Update sheet's row count
          const arr = doc.getArray('sheets');
          for (let i = 0; i < arr.length; i++) {
            const s = arr.get(i) as { id?: string; rowCount?: number };
            if (s?.id === action.sheetId) {
              const newCount = (s.rowCount ?? 100) + 1;
              arr.delete(i, 1);
              arr.insert(i, [{ ...s, rowCount: newCount }]);
              break;
            }
          }
        }
        return;

      case 'sheet.delete_row':
        if (kind !== 'sheet') return;
        {
          // Shift cells down after deleted row
          const cells = doc.getMap('cells');
          const sheetId = action.sheetId;
          const keysToUpdate: Array<{
            oldKey: string;
            newKey: string;
            value: unknown;
          }> = [];
          const keysToDelete: string[] = [];

          for (const key of Array.from(cells.keys())) {
            if (key.startsWith(`${sheetId}:`)) {
              const parts = key.split(':');
              const r = Number(parts[1]);
              const c = Number(parts[2]);
              if (r > action.row) {
                const oldValue = cells.get(key);
                if (oldValue !== undefined) {
                  keysToUpdate.push({
                    oldKey: key,
                    newKey: `${sheetId}:${r - 1}:${c}`,
                    value: oldValue,
                  });
                }
              } else if (r === action.row) {
                keysToDelete.push(key);
              }
            }
          }

          // Delete old keys, then insert new ones
          for (const key of keysToDelete) {
            cells.delete(key);
          }
          for (const { oldKey, newKey, value } of keysToUpdate) {
            cells.delete(oldKey);
            cells.set(newKey, value);
          }

          // Update sheet's row count
          const arr = doc.getArray('sheets');
          for (let i = 0; i < arr.length; i++) {
            const s = arr.get(i) as { id?: string; rowCount?: number };
            if (s?.id === action.sheetId) {
              const newCount = Math.max(1, (s.rowCount ?? 100) - 1);
              arr.delete(i, 1);
              arr.insert(i, [{ ...s, rowCount: newCount }]);
              break;
            }
          }
        }
        return;

      case 'sheet.add_column':
        if (kind !== 'sheet') return;
        {
          // Update sheet's column count
          const arr = doc.getArray('sheets');
          for (let i = 0; i < arr.length; i++) {
            const s = arr.get(i) as { id?: string; colCount?: number };
            if (s?.id === action.sheetId) {
              const newCount = (s.colCount ?? 26) + 1;
              arr.delete(i, 1);
              arr.insert(i, [{ ...s, colCount: newCount }]);
              break;
            }
          }
        }
        return;

      case 'sheet.delete_column':
        if (kind !== 'sheet') return;
        {
          // Shift cells right after deleted column
          const cells = doc.getMap('cells');
          const sheetId = action.sheetId;
          const keysToUpdate: Array<{
            oldKey: string;
            newKey: string;
            value: unknown;
          }> = [];
          const keysToDelete: string[] = [];

          for (const key of Array.from(cells.keys())) {
            if (key.startsWith(`${sheetId}:`)) {
              const parts = key.split(':');
              const r = Number(parts[1]);
              const c = Number(parts[2]);
              if (c > action.col) {
                const oldValue = cells.get(key);
                if (oldValue !== undefined) {
                  keysToUpdate.push({
                    oldKey: key,
                    newKey: `${sheetId}:${r}:${c - 1}`,
                    value: oldValue,
                  });
                }
              } else if (c === action.col) {
                keysToDelete.push(key);
              }
            }
          }

          // Delete old keys, then insert new ones
          for (const key of keysToDelete) {
            cells.delete(key);
          }
          for (const { oldKey, newKey, value } of keysToUpdate) {
            cells.delete(oldKey);
            cells.set(newKey, value);
          }

          // Update sheet's column count
          const arr = doc.getArray('sheets');
          for (let i = 0; i < arr.length; i++) {
            const s = arr.get(i) as { id?: string; colCount?: number };
            if (s?.id === action.sheetId) {
              const newCount = Math.max(1, (s.colCount ?? 26) - 1);
              arr.delete(i, 1);
              arr.insert(i, [{ ...s, colCount: newCount }]);
              break;
            }
          }
        }
        return;

      // ── Extended Google Sheets-parity actions ────────────────

      case 'sheet.set_merges':
        if (kind !== 'sheet') return;
        doc.getMap('merges').set(action.sheetId, action.merges);
        return;

      case 'sheet.set_freeze':
        if (kind !== 'sheet') return;
        if (action.freeze == null) {
          doc.getMap('freezes').delete(action.sheetId);
        } else {
          doc.getMap('freezes').set(action.sheetId, action.freeze);
        }
        return;

      case 'sheet.set_row_height':
        if (kind !== 'sheet') return;
        doc
          .getMap('rowHeights')
          .set(`${action.sheetId}:${action.row}`, action.height);
        return;

      case 'sheet.set_col_width':
        if (kind !== 'sheet') return;
        doc
          .getMap('colWidths')
          .set(`${action.sheetId}:${action.col}`, action.width);
        return;

      case 'sheet.set_conditional_formats':
        if (kind !== 'sheet') return;
        doc.getMap('conditionalFormats').set(action.sheetId, action.rules);
        return;

      case 'sheet.set_data_validations':
        if (kind !== 'sheet') return;
        doc.getMap('dataValidations').set(action.sheetId, action.validations);
        return;

      case 'sheet.clear_range': {
        if (kind !== 'sheet') return;
        const cells = doc.getMap('cells');
        const clearType = action.clearType ?? 'all';
        for (let r = action.fromRow; r <= action.toRow; r++) {
          for (let c = action.fromCol; c <= action.toCol; c++) {
            const key = `${action.sheetId}:${r}:${c}`;
            const existing = cells.get(key) as
              | { value?: unknown; formula?: string; format?: unknown }
              | undefined;
            if (!existing) continue;
            if (clearType === 'all') {
              cells.delete(key);
            } else if (clearType === 'values') {
              cells.set(key, { ...existing, value: null, formula: undefined });
            } else if (clearType === 'formats') {
              cells.set(key, { ...existing, format: undefined });
            }
          }
        }
        return;
      }

      case 'sheet.set_named_range':
        if (kind !== 'sheet') return;
        {
          const named = doc.getMap('namedRanges');
          if (action.range == null) {
            named.delete(action.name);
          } else {
            named.set(action.name, {
              sheetId: action.sheetId,
              range: action.range,
            });
          }
        }
        return;

      // ── Slides ──────────────────────────────────────────────
      case 'slides.add_slide':
        if (kind !== 'slides') return;
        {
          const slides = doc.getArray('slides');
          const newSlide = {
            id: randomUUID(),
            layout: action.layout ?? 'blank',
            background: action.background,
          };
          if (action.afterSlideId) {
            let idx = -1;
            for (let i = 0; i < slides.length; i++) {
              const s = slides.get(i) as { id?: string };
              if (s?.id === action.afterSlideId) {
                idx = i;
                break;
              }
            }
            if (idx >= 0) slides.insert(idx + 1, [newSlide]);
            else slides.push([newSlide]);
          } else {
            slides.push([newSlide]);
          }
        }
        return;
      case 'slides.delete_slide':
        if (kind !== 'slides') return;
        {
          const slides = doc.getArray('slides');
          for (let i = slides.length - 1; i >= 0; i--) {
            const s = slides.get(i) as { id?: string };
            if (s?.id === action.slideId) slides.delete(i, 1);
          }
          const elements = doc.getMap('elements');
          for (const key of Array.from(elements.keys())) {
            if (key.startsWith(`${action.slideId}:`)) elements.delete(key);
          }
        }
        return;
      case 'slides.add_element':
        if (kind !== 'slides') return;
        {
          const elementId = action.element.id ?? randomUUID();
          doc.getMap('elements').set(`${action.slideId}:${elementId}`, {
            ...action.element,
            id: elementId,
          });
        }
        return;
      case 'slides.update_element':
        if (kind !== 'slides') return;
        {
          const key = `${action.slideId}:${action.elementId}`;
          const map = doc.getMap('elements');
          const cur = map.get(key);
          if (cur && typeof cur === 'object') {
            map.set(key, { ...cur, ...action.patch });
          }
        }
        return;
      case 'slides.move_element':
        if (kind !== 'slides') return;
        {
          const key = `${action.slideId}:${action.elementId}`;
          const map = doc.getMap('elements');
          const cur = map.get(key);
          if (cur && typeof cur === 'object') {
            map.set(key, { ...cur, x: action.x, y: action.y });
          }
        }
        return;
      case 'slides.delete_element':
        if (kind !== 'slides') return;
        doc.getMap('elements').delete(`${action.slideId}:${action.elementId}`);
        return;
      case 'slides.update_slide':
        if (kind !== 'slides') return;
        {
          const slides = doc.getArray('slides');
          for (let i = 0; i < slides.length; i++) {
            const slide = slides.get(i) as { id?: string };
            if (slide?.id === action.slideId) {
              slides.delete(i, 1);
              slides.insert(i, [{ ...slide, ...action.patch }]);
              break;
            }
          }
        }
        return;
      case 'slides.apply_theme':
        if (kind !== 'slides') return;
        doc.getMap('theme').set('id', action.themeId);
        return;
    }
  });
}

// ── Read helpers (for the REST snapshot endpoint) ─────────────────

/**
 * Build a plain-JSON snapshot of the Y.Doc for HTTP clients that
 * can't (or don't want to) speak Yjs. The Hocuspocus realtime
 * channel ships the binary update directly; this is the JSON for
 * "give me the current state as plain values".
 */
/**
 * Pull readable plain text out of a doc's live content, regardless of
 * kind. Used to auto-title untitled docs from what they actually say
 * (Google Docs-style). Best-effort: returns "" on any decode trouble
 * rather than throwing into the save path.
 *
 *   document → serialized TipTap/ProseMirror XmlFragment, tags stripped
 *   sheet    → non-empty cell values in row/column order
 *   slides   → text on every slide element
 */
export function extractPlainText(
  doc: Y.Doc,
  kind: WorkspaceDocKind,
  limit = 2000,
): string {
  try {
    if (kind === 'document') {
      const frag = doc.get('content', Y.XmlFragment);
      const xml = frag ? frag.toString() : '';
      return xml
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
    }
    if (kind === 'sheet') {
      const cells = doc.getMap('cells');
      const entries: Array<{ r: number; c: number; v: string }> = [];
      cells.forEach((val, key) => {
        const parts = key.split(':');
        const r = Number(parts[parts.length - 2]);
        const c = Number(parts[parts.length - 1]);
        const raw =
          val && typeof val === 'object'
            ? (val as { value?: unknown }).value
            : val;
        if (raw === null || raw === undefined || raw === '') return;
        entries.push({
          r: Number.isFinite(r) ? r : 0,
          c: Number.isFinite(c) ? c : 0,
          v: String(raw),
        });
      });
      entries.sort((a, b) => a.r - b.r || a.c - b.c);
      return entries
        .map((e) => e.v)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
    }
    // slides
    const elements = doc.getMap('elements');
    const texts: string[] = [];
    elements.forEach((val) => {
      if (val && typeof val === 'object') {
        const t =
          (val as { text?: unknown; content?: unknown }).text ??
          (val as { content?: unknown }).content;
        if (typeof t === 'string' && t.trim()) texts.push(t.trim());
      }
    });
    return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  } catch {
    return '';
  }
}

export function snapshotDoc(doc: Y.Doc, kind: WorkspaceDocKind): unknown {
  if (kind === 'document') {
    return {
      kind: 'document',
      meta: doc.getMap('meta').toJSON(),
      blocks: doc.getArray('blocks').toArray(),
      comments: Array.from(doc.getMap('comments').values()),
    };
  }
  if (kind === 'sheet') {
    return {
      kind: 'sheet',
      sheets: doc.getArray('sheets').toArray(),
      cells: doc.getMap('cells').toJSON(),
      charts: Array.from(doc.getMap('charts').values()),
      merges: doc.getMap('merges').toJSON(),
      freezes: doc.getMap('freezes').toJSON(),
      rowHeights: doc.getMap('rowHeights').toJSON(),
      colWidths: doc.getMap('colWidths').toJSON(),
      conditionalFormats: doc.getMap('conditionalFormats').toJSON(),
      dataValidations: doc.getMap('dataValidations').toJSON(),
      namedRanges: doc.getMap('namedRanges').toJSON(),
    };
  }
  return {
    kind: 'slides',
    slides: doc.getArray('slides').toArray(),
    elements: doc.getMap('elements').toJSON(),
    theme: doc.getMap('theme').toJSON(),
  };
}
