import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import * as Excel from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import * as Y from 'yjs';
import { decodeDoc, snapshotDoc } from './yjs-state';
import { WorkspaceStateService } from './workspace-state.service';

/**
 * Export AI-native workspace docs back to .docx / .xlsx / .pptx so
 * users can hand them to anyone outside Stack62.
 *
 * Pattern: read the Y.Doc snapshot, walk its kind-specific shape,
 * emit the right office file via the existing library
 * (docx / ExcelJS / PptxGenJS). Returns a Buffer the caller streams
 * back as a download or registers as a FileEntity.
 *
 * Round-trip fidelity: import → store → export does NOT yield a
 * byte-identical file. We preserve the *user-visible* content
 * (headings, paragraphs, lists, marks, cells, slide elements) but
 * drop things we don't model (custom theme styles, embedded fonts,
 * cell formulas in their original CellRef form, etc.). That's the
 * deliberate trade — keeping a perfect round-trip would mean
 * shadowing every OOXML quirk in our state model, which is exactly
 * the trap a state-first architecture avoids.
 */
@Injectable()
export class WorkspaceExportService {
  private readonly logger = new Logger(WorkspaceExportService.name);

  constructor(private readonly state: WorkspaceStateService) {}

  async export(
    docId: string,
    actorUserId: string,
    format: 'docx' | 'xlsx' | 'pptx',
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const { doc, bytes } = await this.state.readBinaryState(
      docId,
      actorUserId,
    );
    const yDoc = new Y.Doc();
    if (bytes && bytes.length > 0) {
      Y.applyUpdate(yDoc, new Uint8Array(bytes));
    }
    if (format === 'docx') {
      if (doc.kind !== 'document') {
        throw new BadRequestException(
          `Cannot export ${doc.kind} as .docx.`,
        );
      }
      const buffer = await this.exportDocx(yDoc, doc.title);
      return {
        buffer,
        filename: `${safeName(doc.title)}.docx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    if (format === 'xlsx') {
      if (doc.kind !== 'sheet') {
        throw new BadRequestException(
          `Cannot export ${doc.kind} as .xlsx.`,
        );
      }
      const buffer = await this.exportXlsx(yDoc, doc.title);
      return {
        buffer,
        filename: `${safeName(doc.title)}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    if (format === 'pptx') {
      if (doc.kind !== 'slides') {
        throw new BadRequestException(
          `Cannot export ${doc.kind} as .pptx.`,
        );
      }
      const buffer = await this.exportPptx(yDoc, doc.title);
      return {
        buffer,
        filename: `${safeName(doc.title)}.pptx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
    }
    throw new BadRequestException(`Unknown export format: ${format}`);
  }

  // ── docx ─────────────────────────────────────────────────────────

  private async exportDocx(yDoc: Y.Doc, title: string): Promise<Buffer> {
    const snap = snapshotDoc(yDoc, 'document') as {
      blocks: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    };
    // Phase 1 of the editor stash inserts via doc.insert_block land
    // in a "blocks" Y.Array; the TipTap XmlFragment is owned by the
    // client. So for export today we walk both: the shadow blocks
    // give us heading/paragraph order; the XmlFragment (if filled in)
    // overrides with the live content.
    // The XmlFragment serialization to docx is a future task. For
    // now we render the shadow blocks, which the AI populates via
    // dispatch.
    const paragraphs: Paragraph[] = [];
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 36 })],
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const block of snap.blocks ?? []) {
      const text = String(
        (block.data?.text as string | undefined) ?? '',
      ).trim();
      if (!text) continue;
      const type = block.data?.type ?? block.type;
      if (type === 'heading') {
        const level = Math.max(
          1,
          Math.min(4, Number(block.data?.level ?? 1)),
        );
        paragraphs.push(
          new Paragraph({
            text,
            heading: [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
            ][level - 1],
          }),
        );
      } else if (
        type === 'bulletList' ||
        block.type === 'bullets'
      ) {
        const items = (block.data?.items as string[] | undefined) ?? [];
        for (const item of items) {
          paragraphs.push(
            new Paragraph({
              text: item,
              bullet: { level: 0 },
            }),
          );
        }
      } else {
        paragraphs.push(new Paragraph(text));
      }
    }
    if (paragraphs.length === 1) {
      // Document is just the title — append the snapshot's plain
      // text fallback so the export isn't empty.
      paragraphs.push(
        new Paragraph(
          '(This document has no shadow-block content. Use the workspace editor to write — the rich text is owned by TipTap and will appear in exports once the y-prosemirror round-trip ships.)',
        ),
      );
    }
    const docxDoc = new Document({
      sections: [{ children: paragraphs }],
    });
    return Packer.toBuffer(docxDoc) as unknown as Promise<Buffer>;
  }

  // ── xlsx ─────────────────────────────────────────────────────────

  private async exportXlsx(yDoc: Y.Doc, title: string): Promise<Buffer> {
    const snap = snapshotDoc(yDoc, 'sheet') as {
      sheets: Array<{ id: string; name: string; rowCount: number; colCount: number }>;
      cells: Record<string, { value?: unknown; formula?: string }>;
    };
    const wb = new Excel.Workbook();
    wb.created = new Date();
    wb.title = title;
    for (const sheet of snap.sheets) {
      const ws = wb.addWorksheet(sheet.name);
      // Walk cells map and emit values in their A1 positions.
      for (const [key, cell] of Object.entries(snap.cells)) {
        if (!key.startsWith(`${sheet.id}:`)) continue;
        const [, rowStr, colStr] = key.split(':');
        const row = Number(rowStr) + 1; // ExcelJS rows are 1-indexed
        const col = Number(colStr) + 1;
        const xlCell = ws.getCell(row, col);
        if (cell.formula) {
          // Round-trip formulas as plain text (`=A1+B1`) — ExcelJS
          // supports them via .value = { formula: 'A1+B1' }.
          xlCell.value = { formula: cell.formula };
        } else if (cell.value != null) {
          xlCell.value = cell.value as Excel.CellValue;
        }
      }
    }
    const arrayBuf = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuf as unknown as ArrayBuffer);
  }

  // ── pptx ─────────────────────────────────────────────────────────

  private async exportPptx(yDoc: Y.Doc, title: string): Promise<Buffer> {
    const snap = snapshotDoc(yDoc, 'slides') as {
      slides: Array<{ id: string; layout?: string; background?: string }>;
      elements: Record<
        string,
        {
          id: string;
          type: 'text' | 'shape';
          shape?: 'rect' | 'ellipse';
          x: number;
          y: number;
          width: number;
          height: number;
          rotation?: number;
          text?: string;
          fontSize?: number;
          color?: string;
          fill?: string;
        }
      >;
    };
    const pres = new PptxGenJS();
    pres.title = title;
    pres.layout = 'LAYOUT_16x9';
    // PptxGenJS uses inches; our canvas is 1600×900 px ⇒ 10×5.625 in
    // at 160 dpi. Convert every element coord and dimension into
    // inches so positioning maps cleanly.
    const PX_TO_IN = 10 / 1600; // canvas width 1600 px = 10 in
    for (const slide of snap.slides) {
      const s = pres.addSlide();
      if (slide.background) {
        s.background = { color: slide.background.replace('#', '') };
      }
      for (const [key, el] of Object.entries(snap.elements)) {
        if (!key.startsWith(`${slide.id}:`)) continue;
        const x = el.x * PX_TO_IN;
        const y = el.y * PX_TO_IN;
        const w = el.width * PX_TO_IN;
        const h = el.height * PX_TO_IN;
        if (el.type === 'text') {
          s.addText(el.text ?? '', {
            x,
            y,
            w,
            h,
            fontSize:
              el.fontSize != null
                ? Math.max(8, Math.round(el.fontSize * 0.6))
                : 18,
            color: (el.color ?? '#1f1f1f').replace('#', ''),
          });
        } else if (el.shape === 'ellipse') {
          s.addShape(pres.ShapeType.ellipse, {
            x,
            y,
            w,
            h,
            fill: { color: (el.fill ?? '#34a853').replace('#', '') },
          });
        } else {
          s.addShape(pres.ShapeType.rect, {
            x,
            y,
            w,
            h,
            fill: { color: (el.fill ?? '#1a73e8').replace('#', '') },
          });
        }
      }
    }
    const arrayBuf = (await pres.write({ outputType: 'nodebuffer' })) as
      | Buffer
      | ArrayBuffer;
    return Buffer.isBuffer(arrayBuf)
      ? arrayBuf
      : Buffer.from(arrayBuf as ArrayBuffer);
  }
}

function safeName(s: string): string {
  return (s || 'workspace-doc').replace(/[^\w\-]+/g, '_').slice(0, 80);
}
