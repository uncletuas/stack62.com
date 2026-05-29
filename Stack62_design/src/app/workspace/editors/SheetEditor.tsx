import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridOptions } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  Italic,
  PaintBucket,
  Palette,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";

export type SheetCell = {
  v?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  bg?: string;
  fmt?: "general" | "number" | "percent" | "currency" | "date" | "time" | "text";
};

export type Sheet = {
  name: string;
  rows: SheetCell[][];
};

export type WorkbookJson = {
  version: 1;
  sheets: Sheet[];
};

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;

function colName(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function freshSheet(name: string): Sheet {
  const rows: SheetCell[][] = [];
  for (let r = 0; r < DEFAULT_ROWS; r++) {
    const row: SheetCell[] = [];
    for (let c = 0; c < DEFAULT_COLS; c++) {
      row.push({});
    }
    rows.push(row);
  }
  return { name, rows };
}

function parseWorkbook(text: string): WorkbookJson {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { version: 1, sheets: [freshSheet("Sheet 1")] };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.sheets)) {
      return parsed;
    }
  } catch {
    // Fall through
  }
  const sheet = freshSheet("Sheet 1");
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((line, r) => {
    const cells = line.split(",");
    cells.forEach((cell, c) => {
      if (sheet.rows[r] && sheet.rows[r][c]) {
        sheet.rows[r][c].v = cell;
      }
    });
  });
  return { version: 1, sheets: [sheet] };
}

function evaluateFormula(formula: string, sheet: Sheet): string {
  try {
    // Simple formula evaluator
    let expr = formula.slice(1); // Remove =
    // Replace cell references like A1 with values
    expr = expr.replace(/([A-Z]+)(\d+)/g, (match, col, row) => {
      const colIdx = colNameToIndex(col);
      const rowIdx = parseInt(row, 10) - 1;
      const cell = sheet.rows[rowIdx]?.[colIdx];
      if (!cell?.v) return "0";
      if (cell.v.startsWith("=")) return evaluateFormula(cell.v, sheet);
      return cell.v;
    });
    // Handle SUM, AVERAGE, etc.
    expr = expr.replace(/SUM\(([^)]+)\)/gi, (match, range) => {
      const values = parseRange(range, sheet);
      return values.reduce((a, b) => a + b, 0).toString();
    });
    expr = expr.replace(/AVERAGE\(([^)]+)\)/gi, (match, range) => {
      const values = parseRange(range, sheet);
      return (values.reduce((a, b) => a + b, 0) / values.length).toString();
    });
    expr = expr.replace(/MIN\(([^)]+)\)/gi, (match, range) => {
      const values = parseRange(range, sheet);
      return Math.min(...values).toString();
    });
    expr = expr.replace(/MAX\(([^)]+)\)/gi, (match, range) => {
      const values = parseRange(range, sheet);
      return Math.max(...values).toString();
    });
    // Evaluate the expression
    const result = Function('"use strict";return (' + expr + ")")();
    return result.toString();
  } catch {
    return "#ERROR";
  }
}

function colNameToIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    if (ch < "A" || ch > "Z") return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function parseRange(range: string, sheet: Sheet): number[] {
  const values: number[] = [];
  const parts = range.split(":");
  if (parts.length === 2) {
    const [start, end] = parts;
    const startMatch = start.match(/([A-Z]+)(\d+)/);
    const endMatch = end.match(/([A-Z]+)(\d+)/);
    if (startMatch && endMatch) {
      const startCol = colNameToIndex(startMatch[1]);
      const startRow = parseInt(startMatch[2], 10) - 1;
      const endCol = colNameToIndex(endMatch[1]);
      const endRow = parseInt(endMatch[2], 10) - 1;
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const cell = sheet.rows[r]?.[c];
          if (cell?.v) {
            const val = parseFloat(cell.v);
            if (!isNaN(val)) values.push(val);
          }
        }
      }
    }
  }
  return values;
}

export function SheetEditor({
  text,
  onChange,
  title,
}: {
  text: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const [workbook, setWorkbook] = useState<WorkbookJson>(() => parseWorkbook(text));
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const gridRef = useRef<AgGridReact>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  const lastEmittedRef = useRef<string>("");

  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setWorkbook(parseWorkbook(text));
  }, [text]);

  const activeSheet = workbook.sheets[activeSheetIndex];

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];
    const maxCols = Math.max(DEFAULT_COLS, activeSheet.rows.reduce((max, row) => Math.max(max, row.length), 0));
    for (let i = 0; i < maxCols; i++) {
      cols.push({
        field: `col${i}`,
        headerName: colName(i),
        width: 110,
        editable: true,
        cellRenderer: (params: any) => {
          const cellData = activeSheet.rows[params.rowIndex]?.[params.colDef.field?.slice(3) as unknown as number] || {};
          let displayValue = cellData.v || "";
          if (displayValue.startsWith("=")) {
            displayValue = evaluateFormula(displayValue, activeSheet);
          }
          return (
            <div
              style={{
                fontWeight: cellData.bold ? "bold" : "normal",
                fontStyle: cellData.italic ? "italic" : "normal",
                textDecoration: `${cellData.underline ? "underline" : ""} ${cellData.strike ? "line-through" : ""}`.trim(),
                textAlign: cellData.align || "left",
                color: cellData.color || "inherit",
                backgroundColor: cellData.bg || "transparent",
              }}
            >
              {displayValue}
            </div>
          );
        },
      });
    }
    return cols;
  }, [activeSheet]);

  const rowData = useMemo(() => {
    return activeSheet.rows.map((row, r) => {
      const rowData: any = {};
      row.forEach((cell, c) => {
        rowData[`col${c}`] = cell;
      });
      return rowData;
    });
  }, [activeSheet]);

  const emit = useCallback((newWorkbook: WorkbookJson) => {
    const serialized = JSON.stringify(newWorkbook);
    lastEmittedRef.current = serialized;
    onChange(serialized);
  }, [onChange]);

  const onCellValueChanged = useCallback((params: any) => {
    const rowIdx = params.rowIndex;
    const colIdx = parseInt(params.colDef.field.slice(3), 10);
    setWorkbook((prev) => {
      const newSheets = [...prev.sheets];
      const sheet = { ...newSheets[activeSheetIndex] };
      const newRows = [...sheet.rows];
      newRows[rowIdx] = [...(newRows[rowIdx] || [])];
      newRows[rowIdx][colIdx] = { ...newRows[rowIdx][colIdx], v: params.newValue };
      sheet.rows = newRows;
      newSheets[activeSheetIndex] = sheet;
      const newWorkbook = { ...prev, sheets: newSheets };
      emit(newWorkbook);
      return newWorkbook;
    });
  }, [activeSheetIndex, emit]);

  const applyFormat = useCallback((format: Partial<SheetCell>) => {
    const selectedCells = gridApiRef.current?.getSelectedCells();
    if (!selectedCells) return;
    
    setWorkbook((prev) => {
      const newSheets = [...prev.sheets];
      const sheet = { ...newSheets[activeSheetIndex] };
      const newRows = sheet.rows.map(row => [...row]);
      
      selectedCells.forEach((cell) => {
        const rowIdx = cell.rowIndex;
        const colIdx = parseInt(cell.column.getColId().slice(3), 10);
        newRows[rowIdx] = [...newRows[rowIdx]];
        newRows[rowIdx][colIdx] = { ...newRows[rowIdx][colIdx], ...format };
      });
      
      sheet.rows = newRows;
      newSheets[activeSheetIndex] = sheet;
      const newWorkbook = { ...prev, sheets: newSheets };
      emit(newWorkbook);
      return newWorkbook;
    });
  }, [activeSheetIndex, emit]);

  const addSheet = () => {
    setWorkbook((prev) => {
      const newSheet = freshSheet(`Sheet ${prev.sheets.length + 1}`);
      const newWorkbook = { ...prev, sheets: [...prev.sheets, newSheet] };
      emit(newWorkbook);
      return newWorkbook;
    });
    setActiveSheetIndex(workbook.sheets.length);
  };

  const removeCurrentSheet = () => {
    if (workbook.sheets.length <= 1) return;
    setWorkbook((prev) => {
      const newSheets = prev.sheets.filter((_, i) => i !== activeSheetIndex);
      const newWorkbook = { ...prev, sheets: newSheets };
      emit(newWorkbook);
      return newWorkbook;
    });
    setActiveSheetIndex(Math.max(0, activeSheetIndex - 1));
  };

  const gridOptions: GridOptions = {
    rowHeight: 28,
    headerHeight: 24,
    enableRangeSelection: true,
    onGridReady: (params) => {
      gridApiRef.current = params.api;
    },
  };

  return (
    <div className="flex h-full flex-col bg-white text-gray-800" style={{ "--app-bg": "#ffffff", "--app-border": "#d0d7de" } as React.CSSProperties}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#d0d7de] bg-gray-50 px-3 py-2">
        <ToolbarButton icon={Bold} label="Bold" onClick={() => applyFormat({ bold: !activeSheet.rows[0]?.[0]?.bold })} />
        <ToolbarButton icon={Italic} label="Italic" onClick={() => applyFormat({ italic: !activeSheet.rows[0]?.[0]?.italic })} />
        <ToolbarButton icon={Underline} label="Underline" onClick={() => applyFormat({ underline: !activeSheet.rows[0]?.[0]?.underline })} />
        <ToolbarButton icon={Strikethrough} label="Strikethrough" onClick={() => applyFormat({ strike: !activeSheet.rows[0]?.[0]?.strike })} />
        <Divider />
        <ToolbarButton icon={AlignLeft} label="Align Left" onClick={() => applyFormat({ align: "left" })} />
        <ToolbarButton icon={AlignCenter} label="Align Center" onClick={() => applyFormat({ align: "center" })} />
        <ToolbarButton icon={AlignRight} label="Align Right" onClick={() => applyFormat({ align: "right" })} />
        <Divider />
        <ColorPicker icon={Palette} label="Text Color" onPick={(c) => applyFormat({ color: c })} />
        <ColorPicker icon={PaintBucket} label="Fill Color" onPick={(c) => applyFormat({ bg: c })} />
        <Divider />
        <ToolbarButton icon={Eraser} label="Clear Formatting" onClick={() => applyFormat({ bold: undefined, italic: undefined, underline: undefined, strike: undefined, align: undefined, color: undefined, bg: undefined })} />
        <div className="ml-auto flex items-center gap-2">
          {title && <span className="text-xs text-gray-500">{title}</span>}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0">
        <div className="ag-theme-alpine h-full">
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            gridOptions={gridOptions}
            onCellValueChanged={onCellValueChanged}
          />
        </div>
      </div>

      {/* Sheet Tabs */}
      <div className="flex items-center gap-1 border-t border-[#d0d7de] bg-gray-50 px-2 py-1">
        {workbook.sheets.map((sheet, i) => (
          <button
            key={i}
            onClick={() => setActiveSheetIndex(i)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${i === activeSheetIndex ? "bg-white border-t-2 border-blue-500 text-gray-800" : "text-gray-600 hover:bg-gray-200"}`}
          >
            {sheet.name}
            {workbook.sheets.length > 1 && i === activeSheetIndex && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeCurrentSheet();
                }}
                className="ml-1 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            )}
          </button>
        ))}
        <button
          onClick={addSheet}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: any;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-gray-300" />;
}

function ColorPicker({
  icon: Icon,
  label,
  onPick,
}: {
  icon: any;
  label: string;
  onPick: (color: string) => void;
}) {
  const COLORS = [
    "#1f1f1f", "#5f6368", "#ea4335", "#fbbc04", "#34a853", "#1a73e8", "#a142f4",
    "#ffffff", "#fef7e0", "#e8f5e8", "#e8f0fe", "#fce8e6",
  ];
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
      >
        <Icon className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-wrap gap-1 rounded border border-gray-300 bg-white p-2 shadow-lg">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className="h-6 w-6 rounded border border-gray-300"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
