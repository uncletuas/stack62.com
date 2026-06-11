/**
 * WorkspaceSheetSurface — collaborative spreadsheet powered by Fortune Sheet v1.
 *
 * Fortune Sheet is a Google Sheets clone with 400+ formulas, conditional
 * formatting, data validation, merge cells, freeze panes, borders, charts,
 * and all standard keyboard shortcuts.
 *
 * Sync architecture:
 *   User edit → Fortune Sheet onChange → diff → REST dispatch → Yjs (server)
 *                                                                    ↓
 *   AI / collaborator → Yjs update (Hocuspocus) → ref.updateSheet()
 *
 * Fortune Sheet v1 is UNCONTROLLED: `data` is only read on mount.
 * Subsequent updates from Yjs are pushed via `workbookRef.current.updateSheet()`.
 *
 * Feedback-loop prevention: `skipNextChangeRef` tracks how many incoming
 * onChange calls to ignore after we push a Yjs-driven update.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Workbook } from "@fortune-sheet/react";
import type { WorkbookInstance } from "@fortune-sheet/react";
import type { Sheet, Cell, CellWithRowAndCol, SheetConfig } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import { dispatchWorkspaceAction } from "../../../lib/resources";

// ── Types ────────────────────────────────────────────────────────

interface YjsCell {
  value?: unknown;
  formula?: string;
  format?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    align?: "left" | "center" | "right";
    color?: string;
    background?: string;
    fontSize?: number;
    fontFamily?: string;
    numberFormat?: string;
  };
}

interface SheetMeta {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
}

// ── Cell conversion helpers ───────────────────────────────────────

function yjsCellToFortune(yCell: YjsCell): Cell {
  const fmt = yCell.format ?? {};
  const cell: Cell = {};

  if (yCell.formula) {
    cell.f = `=${yCell.formula}`;
    if (yCell.value != null) cell.v = yCell.value as string | number | boolean;
  } else if (yCell.value != null) {
    cell.v = yCell.value as string | number | boolean;
  }

  if (fmt.bold) cell.bl = 1;
  if (fmt.italic) cell.it = 1;
  if (fmt.underline) cell.un = 1;
  if (fmt.strike) cell.cl = 1;
  if (fmt.color) cell.fc = fmt.color;
  if (fmt.background) cell.bg = fmt.background;
  if (fmt.fontSize) cell.fs = fmt.fontSize;
  if (fmt.fontFamily) cell.ff = fmt.fontFamily;
  if (fmt.align === "left") cell.ht = 1;
  else if (fmt.align === "center") cell.ht = 2;
  else if (fmt.align === "right") cell.ht = 3;

  const nfMap: Record<string, { fa: string; t: string }> = {
    number:   { fa: "0.00",         t: "n" },
    percent:  { fa: "0.00%",        t: "n" },
    currency: { fa: "$#,##0.00",    t: "n" },
    date:     { fa: "yyyy-mm-dd",   t: "d" },
    time:     { fa: "hh:mm:ss",     t: "d" },
    text:     { fa: "@",            t: "s" },
  };
  if (fmt.numberFormat) {
    const mapped = nfMap[fmt.numberFormat];
    cell.ct = mapped ?? { fa: fmt.numberFormat, t: "n" };
  }

  return cell;
}

function fortuneCellToYjs(cell: Cell | null): YjsCell | null {
  if (!cell) return null;
  const hasContent = cell.v != null || cell.f;
  const hasStyle = cell.bl || cell.it || cell.un || cell.cl || cell.fc || cell.bg || cell.fs;
  if (!hasContent && !hasStyle) return null;

  const yjsCell: YjsCell = {};
  if (cell.f) {
    yjsCell.formula = cell.f.startsWith("=") ? cell.f.slice(1) : cell.f;
    if (cell.v != null) yjsCell.value = cell.v;
  } else if (cell.v != null) {
    yjsCell.value = cell.v;
  }

  const fmt: YjsCell["format"] = {};
  if (cell.bl) fmt.bold = true;
  if (cell.it) fmt.italic = true;
  if (cell.un) fmt.underline = true;
  if (cell.cl) fmt.strike = true;
  if (cell.fc) fmt.color = cell.fc;
  if (cell.bg) fmt.background = cell.bg;
  if (cell.fs) fmt.fontSize = cell.fs;
  if (cell.ff) fmt.fontFamily = String(cell.ff);
  if (cell.ht === 1) fmt.align = "left";
  else if (cell.ht === 2) fmt.align = "center";
  else if (cell.ht === 3) fmt.align = "right";
  if (cell.ct?.fa) fmt.numberFormat = cell.ct.fa;

  if (Object.keys(fmt).length) yjsCell.format = fmt;
  return yjsCell;
}

function cellsEqual(a: Cell | null | undefined, b: Cell | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Yjs → Fortune Sheet data builder ─────────────────────────────

function buildFortuneSheets(ydoc: Y.Doc): Sheet[] {
  const sheetsArr = ydoc.getArray("sheets").toArray() as SheetMeta[];
  const cellsMap = ydoc.getMap("cells");
  const mergesMap = ydoc.getMap("merges");
  const rowHeightsMap = ydoc.getMap("rowHeights");
  const colWidthsMap = ydoc.getMap("colWidths");
  const condFormatsMap = ydoc.getMap("conditionalFormats");
  const dataValidMap = ydoc.getMap("dataValidations");

  return sheetsArr.map((sheet, index) => {
    const celldata: CellWithRowAndCol[] = [];

    for (const [key, rawCell] of Array.from(cellsMap.entries())) {
      if (!key.startsWith(`${sheet.id}:`)) continue;
      const parts = key.split(":");
      const r = Number(parts[1]);
      const c = Number(parts[2]);
      const yCell = rawCell as YjsCell;
      if (yCell.value != null || yCell.formula) {
        celldata.push({ r, c, v: yjsCellToFortune(yCell) });
      }
    }

    // Build SheetConfig
    const cfg: SheetConfig = {};
    const merges = mergesMap.get(sheet.id) as SheetConfig["merge"] | undefined;
    if (merges && Object.keys(merges).length) cfg.merge = merges;

    const rowlen: Record<string, number> = {};
    const columnlen: Record<string, number> = {};
    for (const [k, v] of Array.from(rowHeightsMap.entries())) {
      if (k.startsWith(`${sheet.id}:`)) rowlen[k.split(":")[1]] = v as number;
    }
    for (const [k, v] of Array.from(colWidthsMap.entries())) {
      if (k.startsWith(`${sheet.id}:`)) columnlen[k.split(":")[1]] = v as number;
    }
    if (Object.keys(rowlen).length) cfg.rowlen = rowlen;
    if (Object.keys(columnlen).length) cfg.columnlen = columnlen;

    return {
      id: sheet.id,
      name: sheet.name,
      status: index === 0 ? 1 : 0,
      order: index,
      celldata,
      row: sheet.rowCount ?? 200,
      column: sheet.colCount ?? 26,
      config: Object.keys(cfg).length ? cfg : undefined,
      luckysheet_conditionformat_save: condFormatsMap.get(sheet.id) ?? [],
      dataVerification: dataValidMap.get(sheet.id) ?? {},
    } as Sheet;
  });
}

// ── Component ─────────────────────────────────────────────────────

export function WorkspaceSheetSurface({
  docId,
  ydoc,
  organizationId,
  workspaceId,
}: {
  docId: string;
  ydoc: Y.Doc;
  organizationId: string;
  workspaceId: string;
}) {

  const workbookRef = useRef<WorkbookInstance>(null);

  // Initial data (Fortune Sheet is uncontrolled; further updates via ref)
  const [initialData] = useState(() => buildFortuneSheets(ydoc));

  // Track previous state for diffing in onChange
  const prevSheetsRef = useRef<Sheet[]>(initialData);

  // How many onChange calls to skip after a Yjs-driven updateSheet
  const skipNextChangeRef = useRef(0);

  // ── Yjs → Fortune Sheet (push updates via imperative ref) ───────
  useEffect(() => {
    const rebuild = () => {
      const next = buildFortuneSheets(ydoc);
      skipNextChangeRef.current += 1;
      prevSheetsRef.current = next;
      workbookRef.current?.updateSheet(next);
    };

    ydoc.getArray("sheets").observe(rebuild);
    ydoc.getMap("cells").observe(rebuild);
    ydoc.getMap("merges").observe(rebuild);
    ydoc.getMap("rowHeights").observe(rebuild);
    ydoc.getMap("colWidths").observe(rebuild);
    ydoc.getMap("conditionalFormats").observe(rebuild);
    ydoc.getMap("dataValidations").observe(rebuild);

    return () => {
      ydoc.getArray("sheets").unobserve(rebuild);
      ydoc.getMap("cells").unobserve(rebuild);
      ydoc.getMap("merges").unobserve(rebuild);
      ydoc.getMap("rowHeights").unobserve(rebuild);
      ydoc.getMap("colWidths").unobserve(rebuild);
      ydoc.getMap("conditionalFormats").unobserve(rebuild);
      ydoc.getMap("dataValidations").unobserve(rebuild);
    };
  }, [ydoc]);

  // ── Fortune Sheet → Yjs (dispatch workspace actions) ────────────
  const handleChange = useCallback(
    (newSheets: Sheet[]) => {
      if (skipNextChangeRef.current > 0) {
        skipNextChangeRef.current -= 1;
        prevSheetsRef.current = newSheets;
        return;
      }

      const prevSheets = prevSheetsRef.current;
      prevSheetsRef.current = newSheets;

      void (async () => {
        // Deleted sheets
        for (const prev of prevSheets) {
          if (prev.id && !newSheets.find((s) => s.id === prev.id)) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: { verb: "sheet.delete_sheet", sheetId: prev.id },
            }).catch(console.warn);
          }
        }

        for (const next of newSheets) {
          const prev = prevSheets.find((s) => s.id === next.id);

          // New sheet
          if (!prev) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: {
                verb: "sheet.add_sheet",
                name: next.name,
                rowCount: next.row,
                colCount: next.column,
              },
            }).catch(console.warn);
            continue;
          }

          // Renamed sheet
          if (prev.name !== next.name) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: { verb: "sheet.rename_sheet", sheetId: next.id!, name: next.name },
            }).catch(console.warn);
          }

          // Cell changes
          const prevMap = new Map<string, Cell | null>();
          for (const c of prev.celldata ?? []) prevMap.set(`${c.r}:${c.c}`, c.v);

          for (const cell of next.celldata ?? []) {
            const key = `${cell.r}:${cell.c}`;
            const prevCell = prevMap.get(key) ?? null;
            if (!cellsEqual(prevCell, cell.v ?? null)) {
              const yCell = fortuneCellToYjs(cell.v ?? null);
              await dispatchWorkspaceAction({
                organizationId,
                workspaceId,
                docId,
                action: {
                  verb: "sheet.set_cell",
                  sheetId: next.id!,
                  row: cell.r,
                  col: cell.c,
                  value: yCell?.value ?? null,
                  formula: yCell?.formula,
                  format: yCell?.format as never,
                },
              }).catch(console.warn);
            }
            prevMap.delete(key);
          }

          // Cleared cells
          for (const [key, v] of prevMap.entries()) {
            if (v != null) {
              const [r, c] = key.split(":").map(Number);
              await dispatchWorkspaceAction({
                organizationId,
                workspaceId,
                docId,
                action: { verb: "sheet.set_cell", sheetId: next.id!, row: r, col: c, value: null },
              }).catch(console.warn);
            }
          }

          // Merge changes
          const prevMerge = prev.config?.merge ?? {};
          const nextMerge = next.config?.merge ?? {};
          if (JSON.stringify(prevMerge) !== JSON.stringify(nextMerge)) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: { verb: "sheet.set_merges", sheetId: next.id!, merges: nextMerge },
            }).catch(console.warn);
          }

          // Row height / column width changes
          const prevRowlen = prev.config?.rowlen ?? {};
          const nextRowlen = next.config?.rowlen ?? {};
          for (const [rowStr, h] of Object.entries(nextRowlen)) {
            if (prevRowlen[rowStr] !== h) {
              await dispatchWorkspaceAction({
                organizationId,
                workspaceId,
                docId,
                action: { verb: "sheet.set_row_height", sheetId: next.id!, row: Number(rowStr), height: h as number },
              }).catch(console.warn);
            }
          }

          const prevColLen = prev.config?.columnlen ?? {};
          const nextColLen = next.config?.columnlen ?? {};
          for (const [colStr, w] of Object.entries(nextColLen)) {
            if (prevColLen[colStr] !== w) {
              await dispatchWorkspaceAction({
                organizationId,
                workspaceId,
                docId,
                action: { verb: "sheet.set_col_width", sheetId: next.id!, col: Number(colStr), width: w as number },
              }).catch(console.warn);
            }
          }

          // Conditional formats
          const prevCF = JSON.stringify((prev as any).luckysheet_conditionformat_save ?? []);
          const nextCF = JSON.stringify((next as any).luckysheet_conditionformat_save ?? []);
          if (prevCF !== nextCF) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: {
                verb: "sheet.set_conditional_formats",
                sheetId: next.id!,
                rules: (next as any).luckysheet_conditionformat_save ?? [],
              },
            }).catch(console.warn);
          }

          // Data validations
          const prevDV = JSON.stringify(prev.dataVerification ?? {});
          const nextDV = JSON.stringify(next.dataVerification ?? {});
          if (prevDV !== nextDV) {
            await dispatchWorkspaceAction({
              organizationId,
              workspaceId,
              docId,
              action: {
                verb: "sheet.set_data_validations",
                sheetId: next.id!,
                validations: next.dataVerification ?? {},
              },
            }).catch(console.warn);
          }
        }
      })();
    },
    [docId, organizationId, workspaceId],
  );

  return (
    <div className="flex h-full flex-col">
      <style>{`
        .fortune-sheet-main-container { font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', 'Segoe UI', sans-serif !important; }
      `}</style>
      <div className="flex-1 min-h-0">
        <Workbook
          ref={workbookRef}
          data={initialData}
          onChange={handleChange}
          lang="en"
          showToolbar
          showFormulaBar
          showSheetTabs
          allowEdit
        />
      </div>
    </div>
  );
}
