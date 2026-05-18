import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { FilesService } from '../../files/files.service';
import { RecordsService } from '../../records/records.service';
import { SystemsService } from '../../systems/systems.service';
import { tool, type ToolDefinition } from './types';
import type { DocumentSpecBlock } from '../../documents/dto/generate-document.dto';

/**
 * Office tools — the Coworker's bridge to Stack62's Docs / Sheets /
 * Slides editors.
 *
 * Three patterns matter here:
 *
 *   1. **Create-then-open.** Every create_* verb returns a `fileId`.
 *      The Coworker is expected to follow up with a `workspace.open`
 *      call so the user sees what was made. This separation keeps
 *      the create idempotent — re-running it doesn't re-open tabs
 *      while the Coworker is in a planning loop.
 *
 *   2. **Records → sheet is one tool.** A spreadsheet built from
 *      live records (`office.import_records`) is the killer Stack62
 *      feature — Google Sheets doesn't know about your CRM, but the
 *      Coworker does. The output is a real xlsx file the user can
 *      edit, share, or pipe back into a doc via insert.
 *
 *   3. **Blocks are the structured-doc format.** Internally Stack62
 *      renders to docx/xlsx/pptx using the same `DocumentSpecBlock`
 *      shape (heading / paragraph / bullets / numbered / table /
 *      image / pageBreak / slide). The AI emits blocks; we render.
 *      No HTML round-trip; no Word-XML hell.
 */
@Injectable()
export class OfficeTools {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly filesService: FilesService,
    private readonly recordsService: RecordsService,
    private readonly systemsService: SystemsService,
  ) {}

  build(): ToolDefinition[] {
    return [
      // ── Docs ───────────────────────────────────────────────────
      tool(
        'office.create_doc',
        "Create a new Stack62 Docs document (.docx) with a title and structured content. Returns a fileId the Coworker should pair with workspace.open to surface it to the user. Use this for any 'draft me a doc / write a summary / create a report' request.",
        {
          properties: {
            title: { type: 'string', description: 'Document title.' },
            content: {
              type: 'string',
              description:
                'Plain-text body. Newlines split paragraphs; lines starting with `# `, `## `, `### ` become headings; lines starting with `- ` or `* ` become bullets. For complex layouts, pass `blocks` instead.',
            },
            blocks: {
              type: 'array',
              description:
                'Optional structured spec. Each block is { type, text?, items?, rows?, level? }. type ∈ heading|paragraph|bullets|numbered|table|image|pageBreak.',
              items: { type: 'object' },
            },
          },
          required: ['title'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new BadRequestException('workspaceId required.');
          const blocks =
            (input.blocks as DocumentSpecBlock[] | undefined) ??
            textToBlocks(String(input.content ?? ''));
          const result = await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: ctx.systemId ?? undefined,
              format: 'docx',
              title: String(input.title),
              blocks,
            },
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: result.fileId,
              filename: result.filename,
              downloadUrl: result.downloadUrl,
            },
            summary: `Drafted "${result.filename}".`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'office.append_to_doc',
        'Append blocks (heading, paragraph, bullets, table) to an existing Stack62 doc identified by fileId. Use this to extend a draft the user already has open — e.g. adding a new section to a report.',
        {
          properties: {
            fileId: { type: 'string', description: 'Target document fileId.' },
            blocks: {
              type: 'array',
              description: 'Blocks to append. Same shape as office.create_doc.',
              items: { type: 'object' },
            },
            text: {
              type: 'string',
              description:
                'Plain-text alternative — heading/list parsing same as office.create_doc.content.',
            },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new BadRequestException('workspaceId required.');
          const fileId = String(input.fileId);
          const original = await this.filesService.readEditableContent(
            fileId,
            ctx.actorUserId,
          );
          if (original.format !== 'docx') {
            throw new BadRequestException(
              `File is not a docx (got format=${original.format}).`,
            );
          }
          const appendBlocks =
            (input.blocks as DocumentSpecBlock[] | undefined) ??
            textToBlocks(String(input.text ?? ''));
          // Append by re-rendering the doc: existing text becomes a
          // paragraph block, then the new blocks. Lossy on rich
          // formatting but predictable and reversible (versions are
          // kept in `files`).
          const existing: DocumentSpecBlock = {
            type: 'paragraph',
            text: original.text,
          };
          await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: ctx.systemId ?? undefined,
              format: 'docx',
              title: original.filename.replace(/\.docx$/i, ''),
              blocks: [existing, ...appendBlocks],
            },
            ctx.actorUserId,
          );
          return {
            output: { fileId, appended: appendBlocks.length },
            summary: `Appended ${appendBlocks.length} block(s).`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'office.read_file',
        'Read the text content of any Stack62 office file (docx/xlsx/pptx/text). Returns the extracted text plus format/metadata so the Coworker can reason about what is in the file.',
        {
          properties: {
            fileId: { type: 'string', description: 'File id.' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const fileId = String(input.fileId);
          const content = await this.filesService.readEditableContent(
            fileId,
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: content.fileId,
              filename: content.filename,
              format: content.format,
              text: content.text,
            },
            summary: `Read ${content.filename} (${content.format}, ${content.text.length} chars).`,
          };
        },
        { actionLevel: 1 },
      ),

      // ── Sheets ─────────────────────────────────────────────────
      tool(
        'office.create_sheet',
        'Create a new spreadsheet (.xlsx) with a title and optional initial rows. Each row is an array of cell values; the first row is treated as a header by Stack62 Sheet templates.',
        {
          properties: {
            title: { type: 'string', description: 'Sheet title.' },
            rows: {
              type: 'array',
              description:
                "2D array of cell values. e.g. [['Name','Email'],['Ada','ada@x.com']].",
              items: { type: 'array', items: { type: 'string' } },
            },
          },
          required: ['title'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new BadRequestException('workspaceId required.');
          const rows = Array.isArray(input.rows)
            ? (input.rows as unknown[][]).map((row) =>
                row.map((c) => String(c ?? '')),
              )
            : [];
          const result = await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: ctx.systemId ?? undefined,
              format: 'xlsx',
              title: String(input.title),
              blocks:
                rows.length > 0
                  ? [{ type: 'table', rows }]
                  : [{ type: 'paragraph', text: '(empty sheet)' }],
            },
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: result.fileId,
              filename: result.filename,
              rowCount: rows.length,
              downloadUrl: result.downloadUrl,
            },
            summary: `Created "${result.filename}" with ${rows.length} row(s).`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'office.import_records',
        "Pull records from an AI-built system's entity into a brand-new spreadsheet. This is the live-data bridge: the Coworker can say 'export all Companies as a sheet' and get a real xlsx. Provide either entityDefinitionId or systemId (which uses the first entity). Returns fileId + row count.",
        {
          properties: {
            title: {
              type: 'string',
              description:
                "Optional sheet title. Falls back to the entity's name + 'export'.",
            },
            systemId: {
              type: 'string',
              description: 'Source system id (use this OR entityDefinitionId).',
            },
            entityDefinitionId: {
              type: 'string',
              description:
                "Specific entity to export. If omitted, falls back to the system's first entity (or fails if neither provided).",
            },
            limit: {
              type: 'number',
              description: 'Max rows to include (default 200).',
            },
          },
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new BadRequestException('workspaceId required.');
          const systemId =
            typeof input.systemId === 'string' && input.systemId
              ? input.systemId
              : ctx.systemId ?? null;
          const entityDefinitionId =
            typeof input.entityDefinitionId === 'string' &&
            input.entityDefinitionId
              ? input.entityDefinitionId
              : null;
          if (!systemId && !entityDefinitionId) {
            throw new BadRequestException(
              'Provide systemId or entityDefinitionId.',
            );
          }
          const records = await this.recordsService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              ...(systemId ? { systemId } : {}),
              ...(entityDefinitionId ? { entityDefinitionId } : {}),
            },
            ctx.actorUserId,
          );
          // Build a header from the union of all keys across records'
          // `data` payloads. Stack62 records are JSONB so the shape
          // can vary record-to-record; pick the union and stringify.
          const headers = Array.from(
            new Set(
              records.flatMap((r) =>
                r.data && typeof r.data === 'object'
                  ? Object.keys(r.data as Record<string, unknown>)
                  : [],
              ),
            ),
          );
          const limit =
            typeof input.limit === 'number' ? Math.min(input.limit, 1000) : 200;
          const rows: string[][] = [
            ['_id', 'status', 'updatedAt', ...headers],
            ...records.slice(0, limit).map((r) => {
              const data = (r.data ?? {}) as Record<string, unknown>;
              return [
                r.id,
                r.status ?? '',
                r.updatedAt ? new Date(r.updatedAt).toISOString() : '',
                ...headers.map((h) => stringifyCell(data[h])),
              ];
            }),
          ];
          const title =
            (typeof input.title === 'string' && input.title) ||
            (systemId
              ? await this.systemsService
                  .findOne(systemId)
                  .then((s) => `${s.name} export`)
                  .catch(() => 'Records export')
              : 'Records export');
          const result = await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: systemId ?? undefined,
              format: 'xlsx',
              title,
              blocks: [{ type: 'table', rows }],
              metadata: { imported_from: { systemId, entityDefinitionId } },
            },
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: result.fileId,
              filename: result.filename,
              rowCount: rows.length - 1,
              columnCount: rows[0]?.length ?? 0,
              downloadUrl: result.downloadUrl,
            },
            summary: `Exported ${rows.length - 1} record(s) into "${result.filename}".`,
          };
        },
        { actionLevel: 2 },
      ),

      // ── Slides ─────────────────────────────────────────────────
      tool(
        'office.create_slides',
        "Create a new presentation (.pptx) with a title slide plus optional content slides. Each slide has a title and body (bulleted text). Use for 'build me a deck on X' or 'turn this report into slides'.",
        {
          properties: {
            title: {
              type: 'string',
              description: 'Deck title (used on slide 1).',
            },
            subtitle: {
              type: 'string',
              description: 'Optional subtitle for slide 1.',
            },
            slides: {
              type: 'array',
              description:
                "Content slides. Each is { title: string; bullets?: string[]; body?: string }.",
              items: { type: 'object' },
            },
          },
          required: ['title'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new BadRequestException('workspaceId required.');
          const slides =
            (input.slides as Array<{
              title: string;
              bullets?: string[];
              body?: string;
            }>) ?? [];
          const blocks: DocumentSpecBlock[] = [
            {
              type: 'slide',
              title: String(input.title),
              body:
                typeof input.subtitle === 'string' && input.subtitle
                  ? String(input.subtitle)
                  : undefined,
            },
            ...slides.map<DocumentSpecBlock>((s) => ({
              type: 'slide',
              title: String(s.title ?? ''),
              body: s.body,
              items: Array.isArray(s.bullets)
                ? s.bullets.map((b) => String(b))
                : undefined,
            })),
          ];
          const result = await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: ctx.systemId ?? undefined,
              format: 'pptx',
              title: String(input.title),
              blocks,
            },
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: result.fileId,
              filename: result.filename,
              slideCount: blocks.length,
              downloadUrl: result.downloadUrl,
            },
            summary: `Built "${result.filename}" with ${blocks.length} slide(s).`,
          };
        },
        { actionLevel: 2 },
      ),
    ];
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Convert plain text into structured blocks. Rules:
 *   - Lines starting with `# `, `## `, `### ` become heading blocks
 *     of the matching level.
 *   - Lines starting with `- ` or `* ` collect into a bullets block.
 *   - Lines starting with `1.`, `2.` etc. collect into a numbered
 *     block.
 *   - Blank lines split paragraphs.
 * Good enough for the Coworker's typical "here's a memo" output;
 * complex layouts should pass the structured `blocks` field
 * directly.
 */
function textToBlocks(text: string): DocumentSpecBlock[] {
  const blocks: DocumentSpecBlock[] = [];
  if (!text) {
    blocks.push({ type: 'paragraph', text: '' });
    return blocks;
  }
  const lines = text.split(/\r?\n/);
  let bulletBuf: string[] = [];
  let numberedBuf: string[] = [];
  const flush = () => {
    if (bulletBuf.length > 0) {
      blocks.push({ type: 'bullets', items: bulletBuf });
      bulletBuf = [];
    }
    if (numberedBuf.length > 0) {
      blocks.push({ type: 'numbered', items: numberedBuf });
      numberedBuf = [];
    }
  };
  let paragraphBuf = '';
  const flushPara = () => {
    if (paragraphBuf.trim()) {
      blocks.push({ type: 'paragraph', text: paragraphBuf.trim() });
    }
    paragraphBuf = '';
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      flushPara();
      continue;
    }
    const head = /^(#{1,4})\s+(.+)$/.exec(line);
    if (head) {
      flush();
      flushPara();
      blocks.push({
        type: 'heading',
        level: head[1].length,
        text: head[2].trim(),
      });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushPara();
      if (numberedBuf.length) flush();
      bulletBuf.push(bullet[1].trim());
      continue;
    }
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (numbered) {
      flushPara();
      if (bulletBuf.length) flush();
      numberedBuf.push(numbered[1].trim());
      continue;
    }
    flush();
    paragraphBuf += (paragraphBuf ? ' ' : '') + line.trim();
  }
  flush();
  flushPara();
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', text }];
}

function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
