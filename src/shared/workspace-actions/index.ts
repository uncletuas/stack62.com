/**
 * Workspace actions — the typed contract for every mutation of a
 * Stack62 workspace document (text doc, sheet, or slides).
 *
 * This file is the contract. It's imported by the backend
 * `WorkspaceActionService`, the engine `office.dispatch_action`
 * tool, and (via re-export to the frontend) by the editors that
 * generate user-driven actions. Adding a new mutation always means
 * adding a verb here first.
 *
 * Why typed + Zod: an action is a network payload that originates
 * either from an LLM or from a browser, and both can be wrong. Zod
 * gives us validation at the boundary that compiles to a TypeScript
 * union. One source of truth for "what is a legal mutation".
 *
 * Conventions:
 *   - Every verb is `domain.verb` snake_case. `doc.insert_block`,
 *     `sheet.set_cell`, etc.
 *   - Payloads address objects by id. No path arrays, no XPath,
 *     no DOM selectors. Yjs handles ordering; we identify.
 *   - Patches are partial. `update_block(blockId, patch)` only
 *     changes the keys you pass; other fields stay.
 *   - The envelope (id, docId, actor, occurredAt) is added by
 *     `WorkspaceActionEnvelopeSchema` and pre-pended by the
 *     dispatcher so callers don't have to fabricate uuids or
 *     timestamps.
 */

import { z } from 'zod';

// ── Primitives ────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const positiveIntSchema = z.number().int().nonnegative();

const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const cellFormatSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional(),
  background: z.string().optional(),
  numberFormat: z
    .enum(['general', 'number', 'percent', 'currency', 'date', 'time', 'text'])
    .optional(),
});

const tipTapBlockSchema = z.object({
  // A TipTap/ProseMirror node. We don't recurse fully into the schema
  // here — the editor is the source of truth for its own grammar.
  // We validate the outer envelope is a JSON object and trust TipTap
  // to refuse malformed nodes when it applies the update.
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(z.unknown()).optional(),
  marks: z.array(z.unknown()).optional(),
  text: z.string().optional(),
});

const slideElementSchema = z.object({
  id: uuidSchema.optional(), // server fills if absent
  type: z.enum(['text', 'image', 'shape', 'chart']),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().optional(),
  // Type-specific fields.
  text: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  src: z.string().optional(), // for images
  shape: z.enum(['rect', 'ellipse', 'line']).optional(),
  // Chart subtype carries its own config; we don't constrain
  // it tightly here so chart types can grow without breaking
  // the action schema.
  chart: z
    .object({
      type: z.string(),
      sourceRange: z.string(),
      options: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

// ── Discriminated payloads ─────────────────────────────────────────

const WorkspaceCreateDocSchema = z.object({
  verb: z.literal('workspace.create_doc'),
  kind: z.enum(['document', 'sheet', 'slides']),
  title: z.string().min(1).max(200),
  /**
   * Initial state. Shape depends on `kind`. For documents, this is
   * TipTap JSON. For sheets, a 2D array of values. For slides, an
   * array of slide layouts. The dispatcher hands this to the
   * kind-specific initializer.
   */
  initial: z.unknown().optional(),
});

const WorkspaceRenameDocSchema = z.object({
  verb: z.literal('workspace.rename_doc'),
  title: z.string().min(1).max(200),
});

const WorkspaceDeleteDocSchema = z.object({
  verb: z.literal('workspace.delete_doc'),
});

const DocReplaceContentSchema = z.object({
  verb: z.literal('doc.replace_content'),
  tipTapJson: z.unknown(), // TipTap doc JSON; trust the editor's grammar
});

const DocInsertBlockSchema = z.object({
  verb: z.literal('doc.insert_block'),
  block: tipTapBlockSchema,
  afterBlockId: uuidSchema.optional(),
  atStart: z.boolean().optional(),
});

const DocUpdateBlockSchema = z.object({
  verb: z.literal('doc.update_block'),
  blockId: uuidSchema,
  patch: z.record(z.string(), z.unknown()),
});

const DocDeleteBlockSchema = z.object({
  verb: z.literal('doc.delete_block'),
  blockId: uuidSchema,
});

const DocAddCommentSchema = z.object({
  verb: z.literal('doc.add_comment'),
  anchorBlockId: uuidSchema,
  body: z.string().min(1).max(4000),
});

const DocFormatRangeSchema = z.object({
  verb: z.literal('doc.format_range'),
  // ProseMirror coordinates — interpreted by the editor.
  from: positiveIntSchema,
  to: positiveIntSchema,
  marks: z.record(z.string(), z.unknown()),
});

// Sheet actions ----------------------------------------------------

const SheetAddSheetSchema = z.object({
  verb: z.literal('sheet.add_sheet'),
  name: z.string().min(1).max(64),
  rowCount: positiveIntSchema.optional(),
  colCount: positiveIntSchema.optional(),
});

const SheetDeleteSheetSchema = z.object({
  verb: z.literal('sheet.delete_sheet'),
  sheetId: uuidSchema,
});

const SheetSetCellSchema = z.object({
  verb: z.literal('sheet.set_cell'),
  sheetId: uuidSchema,
  row: positiveIntSchema,
  col: positiveIntSchema,
  value: cellValueSchema.optional(),
  formula: z.string().optional(),
  format: cellFormatSchema.optional(),
});

const SheetSetRangeSchema = z.object({
  verb: z.literal('sheet.set_range'),
  sheetId: uuidSchema,
  fromRow: positiveIntSchema,
  fromCol: positiveIntSchema,
  rows: z.array(z.array(cellValueSchema)),
});

const SheetAddChartSchema = z.object({
  verb: z.literal('sheet.add_chart'),
  sheetId: uuidSchema,
  sourceRange: z.string(), // e.g. "A1:C10"
  type: z.enum(['line', 'bar', 'pie', 'area', 'scatter']),
  title: z.string().optional(),
});

const SheetUpdateChartSchema = z.object({
  verb: z.literal('sheet.update_chart'),
  chartId: uuidSchema,
  patch: z.record(z.string(), z.unknown()),
});

const SheetDeleteChartSchema = z.object({
  verb: z.literal('sheet.delete_chart'),
  chartId: uuidSchema,
});

const SheetSortSchema = z.object({
  verb: z.literal('sheet.sort'),
  sheetId: uuidSchema,
  column: positiveIntSchema,
  direction: z.enum(['asc', 'desc']),
});

const SheetFilterSchema = z.object({
  verb: z.literal('sheet.filter'),
  sheetId: uuidSchema,
  column: positiveIntSchema,
  predicate: z.object({
    op: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']),
    value: cellValueSchema,
  }),
});

// Slide actions ----------------------------------------------------

const SlidesAddSlideSchema = z.object({
  verb: z.literal('slides.add_slide'),
  afterSlideId: uuidSchema.optional(),
  layout: z
    .enum(['blank', 'title', 'title-content', 'two-column'])
    .optional(),
  background: z.string().optional(), // hex color or url
});

const SlidesDeleteSlideSchema = z.object({
  verb: z.literal('slides.delete_slide'),
  slideId: uuidSchema,
});

const SlidesAddElementSchema = z.object({
  verb: z.literal('slides.add_element'),
  slideId: uuidSchema,
  element: slideElementSchema,
});

const SlidesUpdateElementSchema = z.object({
  verb: z.literal('slides.update_element'),
  slideId: uuidSchema,
  elementId: uuidSchema,
  patch: z.record(z.string(), z.unknown()),
});

const SlidesMoveElementSchema = z.object({
  verb: z.literal('slides.move_element'),
  slideId: uuidSchema,
  elementId: uuidSchema,
  x: z.number(),
  y: z.number(),
});

const SlidesDeleteElementSchema = z.object({
  verb: z.literal('slides.delete_element'),
  slideId: uuidSchema,
  elementId: uuidSchema,
});

const SlidesUpdateSlideSchema = z.object({
  verb: z.literal('slides.update_slide'),
  slideId: z.string().uuid(),
  patch: z.record(z.string(), z.unknown()),
});

const SlidesApplyThemeSchema = z.object({
  verb: z.literal('slides.apply_theme'),
  themeId: z.string().min(1).max(64),
});

// ── Union ──────────────────────────────────────────────────────────

export const WorkspaceActionPayloadSchema = z.discriminatedUnion('verb', [
  WorkspaceCreateDocSchema,
  WorkspaceRenameDocSchema,
  WorkspaceDeleteDocSchema,
  DocReplaceContentSchema,
  DocInsertBlockSchema,
  DocUpdateBlockSchema,
  DocDeleteBlockSchema,
  DocAddCommentSchema,
  DocFormatRangeSchema,
  SheetAddSheetSchema,
  SheetDeleteSheetSchema,
  SheetSetCellSchema,
  SheetSetRangeSchema,
  SheetAddChartSchema,
  SheetUpdateChartSchema,
  SheetDeleteChartSchema,
  SheetSortSchema,
  SheetFilterSchema,
  SlidesAddSlideSchema,
  SlidesDeleteSlideSchema,
  SlidesAddElementSchema,
  SlidesUpdateElementSchema,
  SlidesMoveElementSchema,
  SlidesDeleteElementSchema,
  SlidesUpdateSlideSchema,
  SlidesApplyThemeSchema,
]);

export type WorkspaceActionPayload = z.infer<
  typeof WorkspaceActionPayloadSchema
>;

/**
 * Full action envelope. `id`, `docId`, `actorKind`, `actorUserId`,
 * `coworkerId`, `occurredAt` are added by the dispatcher — callers
 * only need to supply the payload.
 */
export const WorkspaceActionEnvelopeSchema = z
  .object({
    id: uuidSchema,
    docId: uuidSchema,
    actorKind: z.enum(['user', 'coworker']),
    actorUserId: uuidSchema,
    coworkerId: uuidSchema.nullable().optional(),
    occurredAt: z.string().datetime(),
  })
  .and(WorkspaceActionPayloadSchema);

export type WorkspaceAction = z.infer<typeof WorkspaceActionEnvelopeSchema>;

/**
 * Shape passed by callers when dispatching. The dispatcher fills in
 * the envelope fields.
 */
export const WorkspaceActionInputSchema = z
  .object({
    docId: uuidSchema,
  })
  .and(WorkspaceActionPayloadSchema);

export type WorkspaceActionInput = z.infer<typeof WorkspaceActionInputSchema>;

// ── Verb lookup (for the engine tool's enum) ──────────────────────

export const WORKSPACE_ACTION_VERBS = [
  'workspace.create_doc',
  'workspace.rename_doc',
  'workspace.delete_doc',
  'doc.replace_content',
  'doc.insert_block',
  'doc.update_block',
  'doc.delete_block',
  'doc.add_comment',
  'doc.format_range',
  'sheet.add_sheet',
  'sheet.delete_sheet',
  'sheet.set_cell',
  'sheet.set_range',
  'sheet.add_chart',
  'sheet.update_chart',
  'sheet.delete_chart',
  'sheet.sort',
  'sheet.filter',
  'slides.add_slide',
  'slides.delete_slide',
  'slides.add_element',
  'slides.update_element',
  'slides.move_element',
  'slides.delete_element',
  'slides.update_slide',
  'slides.apply_theme',
] as const;

export type WorkspaceActionVerb = (typeof WORKSPACE_ACTION_VERBS)[number];

export type WorkspaceDocKind = 'document' | 'sheet' | 'slides';

/** Calculate inverse action to undo a given action */
export function getInverseAction(action: WorkspaceActionPayload, previousState?: unknown): WorkspaceActionPayload | null {
  switch (action.verb) {
    case 'sheet.set_cell':
      // Need previous cell value to invert
      return {
        verb: 'sheet.set_cell',
        sheetId: action.sheetId,
        row: action.row,
        col: action.col,
        value: null,
        formula: undefined,
        format: undefined,
      };

    case 'sheet.add_sheet':
      return {
        verb: 'sheet.delete_sheet',
        sheetId: '', // Will be filled in when action is applied
      };

    case 'slides.add_element':
      return {
        verb: 'slides.delete_element',
        slideId: action.slideId,
        elementId: '', // Will be filled in when action is applied
      };

    case 'slides.delete_element':
      // Need previous element to restore
      return null;

    case 'slides.update_element':
      // Need previous state to invert
      return null;

    default:
      return null;
  }
}
