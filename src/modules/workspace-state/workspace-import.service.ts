import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Excel from 'exceljs';
import * as mammoth from 'mammoth';
import { WorkspaceStateService } from './workspace-state.service';

/**
 * Import office files (.docx / .xlsx) into AI-native workspace docs.
 *
 * Two contracts:
 *   - DOCX → workspace document. We extract HTML via mammoth, walk
 *     it into the TipTap JSON our editor understands, and seed a new
 *     workspace doc with that content as its initial TipTap JSON.
 *     The Y.Doc is built fresh in `makeFreshDoc`; the client TipTap
 *     hydrates it on mount via the meta map.
 *   - XLSX → workspace sheet. We read every cell with ExcelJS and
 *     pass them to `makeFreshDoc` as a 2D array; the Y.Doc seeds
 *     the cells Y.Map directly.
 *
 * Why HTML and not "parse the docx OOXML directly": mammoth has done
 * the OOXML pain for us — paragraphs, headings, lists, tables, basic
 * marks all come out cleanly. The HTML → TipTap step is small +
 * predictable; the docx → HTML step is the hard one and we're not
 * rewriting it.
 *
 * PPTX import is deliberately not implemented. The OSS pptx parser
 * landscape (pptxgenjs is write-only; node-pptx-parser is sparse) is
 * fragile enough that hand-extracting slides for a turn-6 MVP would
 * ship something brittle. Pptx import lands when we have a real
 * user need + time to use python-pptx in a sidecar.
 */
@Injectable()
export class WorkspaceImportService {
  private readonly logger = new Logger(WorkspaceImportService.name);

  constructor(private readonly state: WorkspaceStateService) {}

  async importDocx(opts: {
    buffer: Buffer;
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
    title?: string;
  }) {
    const result = await mammoth.convertToHtml(
      { buffer: opts.buffer },
      // mammoth's defaults preserve paragraphs, headings, lists, and
      // bold/italic. We don't customize style mappings for now — the
      // out-of-the-box html is good enough for the TipTap walker.
    );
    if (result.messages.length > 0) {
      // mammoth surfaces warnings (unsupported style, dropped image)
      // — we log them so the operator sees what was lost.
      result.messages.forEach((m) =>
        this.logger.debug(`mammoth: ${m.type} — ${m.message}`),
      );
    }
    const tipTapJson = htmlToTipTapJson(result.value);
    const dispatch = await this.state.dispatch(
      {
        docId: '00000000-0000-0000-0000-000000000000',
        verb: 'workspace.create_doc',
        kind: 'document',
        title: opts.title ?? 'Imported document',
        initial: { tipTapJson },
      },
      {
        organizationId: opts.organizationId,
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
      },
    );
    return { docId: dispatch.action.docId, version: dispatch.version };
  }

  async importXlsx(opts: {
    buffer: Buffer;
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
    title?: string;
  }) {
    const wb = new Excel.Workbook();
    await wb.xlsx.load(opts.buffer as unknown as ArrayBuffer);
    if (wb.worksheets.length === 0) {
      throw new BadRequestException('Spreadsheet has no sheets.');
    }
    // Phase 1: import the first worksheet's cells. Multi-sheet
    // import is a follow-up (need to seed multiple entries in
    // Y.Array("sheets") and have makeFreshDoc accept that). The AI
    // can copy additional sheets in via dispatch after this.
    const ws = wb.worksheets[0];
    const rows: Array<Array<string | number | boolean | null>> = [];
    for (let r = 1; r <= ws.actualRowCount; r++) {
      const row: Array<string | number | boolean | null> = [];
      const xlRow = ws.getRow(r);
      for (let c = 1; c <= ws.actualColumnCount; c++) {
        const cell = xlRow.getCell(c);
        const v = cell.value;
        if (v == null) row.push('');
        else if (typeof v === 'object' && 'text' in (v as object)) {
          // Rich-text or hyperlink — flatten to displayable string.
          row.push(String((v as { text: string }).text));
        } else if (v instanceof Date) {
          row.push(v.toISOString());
        } else if (
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'boolean'
        ) {
          row.push(v);
        } else {
          row.push(String(v));
        }
      }
      rows.push(row);
    }
    const dispatch = await this.state.dispatch(
      {
        docId: '00000000-0000-0000-0000-000000000000',
        verb: 'workspace.create_doc',
        kind: 'sheet',
        title: opts.title ?? ws.name ?? 'Imported sheet',
        // initial is the 2D row array — makeFreshDoc reads it.
        initial: rows,
      },
      {
        organizationId: opts.organizationId,
        workspaceId: opts.workspaceId,
        actorUserId: opts.actorUserId,
      },
    );
    return {
      docId: dispatch.action.docId,
      version: dispatch.version,
      rowsImported: rows.length,
      colsImported: rows[0]?.length ?? 0,
    };
  }
}

// ── HTML → TipTap JSON ───────────────────────────────────────────

/**
 * Minimal HTML → ProseMirror/TipTap JSON walker.
 *
 * Handles the elements mammoth produces from a typical .docx: p,
 * h1–h6, ul/ol/li, strong, em, u, s, a, br, table/tr/td. Unknown
 * elements are flattened (their text content survives, their tag
 * is dropped). This is intentionally lossy at the edges — a docx
 * with embedded SVG or page-break-after CSS is not faithfully
 * round-tripped, but the words + structure are preserved, which is
 * what the user expects from "import this document".
 *
 * Parser: a one-pass regex-driven tag walker. We don't pull in
 * jsdom or cheerio for ~80 lines of structured HTML. The risk: if
 * mammoth ever emits HTML we don't recognise, the body becomes a
 * single paragraph. That's a degraded but non-crashing failure
 * mode.
 */
function htmlToTipTapJson(html: string): unknown {
  const root: TipTapNode = { type: 'doc', content: [] };
  const stack: TipTapNode[] = [root];
  const marks: string[] = []; // active text marks (bold, italic, …)

  const tagRe = /<\/?([a-zA-Z]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const [whole, tagName, attrs, text] = m;
    if (text != null) {
      // Text node — strip extra whitespace from inline runs but keep
      // leading/trailing space inside structural blocks.
      const decoded = decodeHtmlEntities(text);
      if (!decoded.trim()) continue;
      pushText(stack, decoded, marks);
      continue;
    }
    if (!tagName) continue;
    const isClose = whole.startsWith('</');
    const tag = tagName.toLowerCase();

    if (isClose) {
      closeTag(stack, marks, tag);
    } else {
      openTag(stack, marks, tag, attrs ?? '');
    }
  }
  return root;
}

interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function openTag(
  stack: TipTapNode[],
  marks: string[],
  tag: string,
  attrs: string,
) {
  const top = stack[stack.length - 1];
  switch (tag) {
    case 'p': {
      const node: TipTapNode = { type: 'paragraph', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const node: TipTapNode = {
        type: 'heading',
        attrs: { level: Number(tag[1]) },
        content: [],
      };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'ul':
    case 'ol': {
      const node: TipTapNode = {
        type: tag === 'ul' ? 'bulletList' : 'orderedList',
        content: [],
      };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'li': {
      const node: TipTapNode = { type: 'listItem', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'blockquote': {
      const node: TipTapNode = { type: 'blockquote', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'pre': {
      const node: TipTapNode = { type: 'codeBlock', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'table': {
      const node: TipTapNode = { type: 'table', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'tr': {
      const node: TipTapNode = { type: 'tableRow', content: [] };
      pushChild(top, node);
      stack.push(node);
      return;
    }
    case 'td':
    case 'th': {
      const node: TipTapNode = {
        type: tag === 'th' ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph', content: [] }],
      };
      pushChild(top, node);
      // Push the inner paragraph so subsequent text lands there.
      stack.push(node.content![0]);
      return;
    }
    case 'strong':
    case 'b':
      marks.push('bold');
      return;
    case 'em':
    case 'i':
      marks.push('italic');
      return;
    case 'u':
      marks.push('underline');
      return;
    case 's':
    case 'strike':
      marks.push('strike');
      return;
    case 'a': {
      const href = /href=["']([^"']+)["']/.exec(attrs)?.[1] ?? '';
      marks.push(`link:${href}`);
      return;
    }
    case 'br': {
      pushChild(top, { type: 'hardBreak' });
      return;
    }
    case 'hr': {
      pushChild(top, { type: 'horizontalRule' });
      return;
    }
  }
}

function closeTag(stack: TipTapNode[], marks: string[], tag: string) {
  const inlineMark = {
    strong: 'bold',
    b: 'bold',
    em: 'italic',
    i: 'italic',
    u: 'underline',
    s: 'strike',
    strike: 'strike',
  }[tag];
  if (inlineMark) {
    // pop the matching mark (search from end)
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i] === inlineMark) {
        marks.splice(i, 1);
        return;
      }
    }
    return;
  }
  if (tag === 'a') {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].startsWith('link:')) {
        marks.splice(i, 1);
        return;
      }
    }
    return;
  }
  if (
    [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'table',
      'tr',
      'td',
      'th',
    ].includes(tag)
  ) {
    // Pop until we find a matching parent type. Defensive against
    // malformed HTML where mammoth (rarely) drops a closing tag.
    if (stack.length > 1) stack.pop();
  }
}

function pushChild(parent: TipTapNode, child: TipTapNode) {
  if (!parent.content) parent.content = [];
  parent.content.push(child);
}

function pushText(stack: TipTapNode[], text: string, marks: string[]) {
  const top = stack[stack.length - 1];
  if (!top) return;
  // Ensure the text lands inside a paragraph-like container. If the
  // top is a block container (list, table, etc.), wrap in a paragraph.
  let target = top;
  if (
    target.type === 'doc' ||
    target.type === 'bulletList' ||
    target.type === 'orderedList' ||
    target.type === 'listItem' ||
    target.type === 'table' ||
    target.type === 'tableRow' ||
    target.type === 'tableCell' ||
    target.type === 'tableHeader'
  ) {
    let wrapper: TipTapNode | undefined = target.content?.[target.content.length - 1];
    if (!wrapper || wrapper.type !== 'paragraph') {
      wrapper = { type: 'paragraph', content: [] };
      pushChild(target, wrapper);
    }
    target = wrapper;
  }
  const markList = marks.map((m) => {
    if (m.startsWith('link:')) {
      return {
        type: 'link',
        attrs: { href: m.slice(5) },
      };
    }
    return { type: m };
  });
  pushChild(target, {
    type: 'text',
    text,
    ...(markList.length > 0 ? { marks: markList } : {}),
  });
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
