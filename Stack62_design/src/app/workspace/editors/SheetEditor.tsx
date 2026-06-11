/**
 * SheetEditor — standalone (non-collaborative) spreadsheet editor.
 *
 * Used when the user opens a .xlsx/.csv file that is NOT yet converted to a
 * collaborative workspace doc. Backed by Fortune Sheet for complete Google
 * Sheets parity: 400+ formulas, charts, conditional formatting, data
 * validation, freeze panes, merge cells, etc.
 *
 * State is serialised as a JSON array of Fortune Sheet Sheet objects and
 * persisted via the `onChange` callback. Legacy AG Grid JSON (version:1)
 * and CSV are auto-upgraded on first open.
 */
import { useCallback, useMemo, useRef } from "react";
import { Workbook } from "@fortune-sheet/react";
import type { Sheet, CellWithRowAndCol } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";

// ── Workbook parsing ──────────────────────────────────────────────

function parseWorkbook(text: string): Sheet[] {
  const trimmed = (text ?? "").trim();

  // Fortune Sheet JSON array
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[];
      if (Array.isArray(parsed) && parsed.length > 0 && typeof (parsed[0] as any)?.name === "string") {
        return parsed as Sheet[];
      }
    } catch {
      // fall through
    }
  }

  // Legacy v1 JSON (old AG Grid format: {version:1, sheets:[{name, rows:[...]}]})
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        version?: number;
        sheets?: Array<{ name: string; rows: Array<Array<{ v?: string }>> }>;
      };
      if (parsed.version === 1 && Array.isArray(parsed.sheets)) {
        return parsed.sheets.map((s, index) => {
          const celldata: CellWithRowAndCol[] = [];
          s.rows.forEach((row, r) => {
            row.forEach((cell, c) => {
              if (cell?.v) celldata.push({ r, c, v: { v: cell.v } });
            });
          });
          return {
            id: `sheet-${index}`,
            name: s.name,
            status: index === 0 ? 1 : 0,
            celldata,
            row: Math.max(200, s.rows.length + 50),
            column: 26,
          } satisfies Sheet;
        });
      }
    } catch {
      // fall through
    }
  }

  // CSV fallback
  if (trimmed) {
    const lines = trimmed.split(/\r?\n/);
    const celldata: CellWithRowAndCol[] = [];
    lines.forEach((line, r) => {
      line.split(",").forEach((val, c) => {
        const v = val.trim();
        if (v) celldata.push({ r, c, v: { v } });
      });
    });
    return [
      {
        id: "sheet-0",
        name: "Sheet1",
        status: 1,
        celldata,
        row: Math.max(200, lines.length + 50),
        column: 26,
      } satisfies Sheet,
    ];
  }

  // Empty workbook
  return [{ id: "sheet-0", name: "Sheet1", status: 1, celldata: [], row: 200, column: 26 } satisfies Sheet];
}

// ── Component ─────────────────────────────────────────────────────

export function SheetEditor({
  text,
  onChange,
  title,
}: {
  text: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const initialData = useMemo(() => parseWorkbook(text), []);
  const lastEmittedRef = useRef("");

  const handleChange = useCallback(
    (data: Sheet[]) => {
      const serialized = JSON.stringify(data);
      if (serialized === lastEmittedRef.current) return;
      lastEmittedRef.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  return (
    <div className="flex h-full flex-col bg-white">
      {title && (
        <div className="flex h-10 shrink-0 items-center border-b border-[#dadce0] bg-white px-4">
          <span className="text-sm font-medium text-[#202124]">{title}</span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Workbook
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

// Re-export legacy types for consumers that still import from here
export type SheetCell = {
  v?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  bg?: string;
  fmt?: string;
};

export type WorkbookJson = {
  version: 1;
  sheets: Array<{ name: string; rows: SheetCell[][] }>;
};
