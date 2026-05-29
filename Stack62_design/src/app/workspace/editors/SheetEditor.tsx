import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridOptions } from "ag-grid-community";
import {
  Undo2,
  Redo2,
  Printer,
  ZoomIn,
  ZoomOut,
  Bold,
  Italic,
  Underline,
  Type,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import "ag-grid-community/styles/ag-grid.min.css";
import "ag-grid-community/styles/ag-theme-quartz.min.css";

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

const DEFAULT_ROWS = 1000;
const DEFAULT_COLS = 26;

function colName(idx: number): string {
  let name = "";
  let n = idx + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
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
  if (!trimmed) return { version: 1, sheets: [freshSheet("Sheet1")] };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.sheets)) {
      return parsed;
    }
  } catch {
    // Fall through
  }
  const sheet = freshSheet("Sheet1");
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
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [formulaBarValue, setFormulaBarValue] = useState("");

  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setWorkbook(parseWorkbook(text));
  }, [text]);

  const activeSheet = workbook.sheets[activeSheetIndex];

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];
    for (let c = 0; c < DEFAULT_COLS; c++) {
      cols.push({
        field: `col${c}`,
        headerName: colName(c),
        width: 120,
        editable: true,
        resizable: true,
        sortable: false,
        filter: false,
        cellStyle: (params) => {
          const cellData = activeSheet.rows[params.rowIndex]?.[c] || {};
          return {
            fontWeight: cellData.bold ? "bold" : "normal",
            fontStyle: cellData.italic ? "italic" : "normal",
            textDecoration: `${cellData.underline ? "underline" : ""} ${cellData.strike ? "line-through" : ""}`.trim(),
            textAlign: cellData.align || "left",
            color: cellData.color || "#000000",
            backgroundColor: cellData.bg || "#ffffff",
          };
        },
        valueGetter: (params) => {
          const cellData = activeSheet.rows[params.rowIndex]?.[c] || {};
          let displayValue = cellData.v || "";
          if (displayValue.startsWith("=")) {
            displayValue = evaluateFormula(displayValue, activeSheet);
          }
          return displayValue;
        },
      });
    }
    return cols;
  }, [activeSheet]);

  const rowData = useMemo(() => {
    return activeSheet.rows.map((row, r) => {
      const rowData: any = {};
      rowData.rowNumber = r + 1;
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
      newRows[rowIdx] = [...newRows[rowIdx]];
      newRows[rowIdx][colIdx] = { ...newRows[rowIdx][colIdx], v: params.newValue };
      sheet.rows = newRows;
      newSheets[activeSheetIndex] = sheet;
      const newWorkbook = { ...prev, sheets: newSheets };
      emit(newWorkbook);
      return newWorkbook;
    });
  }, [activeSheetIndex, emit]);

  const onCellClicked = useCallback((params: any) => {
    const colIdx = parseInt(params.colDef.field.slice(3), 10);
    const rowIdx = params.rowIndex;
    setSelectedCell({ row: rowIdx, col: colIdx });
    const cellData = activeSheet.rows[rowIdx]?.[colIdx];
    setFormulaBarValue(cellData?.v || "");
  }, [activeSheet]);

  const applyFormat = useCallback((format: Partial<SheetCell>) => {
    if (!selectedCell) return;
    setWorkbook((prev) => {
      const newSheets = [...prev.sheets];
      const sheet = { ...newSheets[activeSheetIndex] };
      const newRows = sheet.rows.map(row => [...row]);
      newRows[selectedCell.row] = [...newRows[selectedCell.row]];
      newRows[selectedCell.row][selectedCell.col] = { ...newRows[selectedCell.row][selectedCell.col], ...format };
      sheet.rows = newRows;
      newSheets[activeSheetIndex] = sheet;
      const newWorkbook = { ...prev, sheets: newSheets };
      emit(newWorkbook);
      return newWorkbook;
    });
  }, [activeSheetIndex, emit, selectedCell]);

  const addSheet = () => {
    setWorkbook((prev) => {
      const newSheet = freshSheet(`Sheet${prev.sheets.length + 1}`);
      const newWorkbook = { ...prev, sheets: [...prev.sheets, newSheet] };
      emit(newWorkbook);
      return newWorkbook;
    });
    setActiveSheetIndex(workbook.sheets.length);
  };

  const gridOptions: GridOptions = {
    rowHeight: 28,
    headerHeight: 28,
    enableRangeSelection: true,
    onGridReady: (params) => {
      gridApiRef.current = params.api;
    },
    onCellValueChanged,
    onCellClicked,
    suppressColumnVirtualisation: true,
  };

  const currentCellStyle = selectedCell ? activeSheet.rows[selectedCell.row]?.[selectedCell.col] : {};

  return (
    <div className="flex h-full flex-col bg-white text-[#202124]">
      {/* Google-style top bar */}
      <div className="flex h-12 items-center gap-2 border-b border-[#dadce0] bg-white px-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-[#34a853] rounded flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <input
            type="text"
            value={title || "Untitled spreadsheet"}
            className="border-none bg-transparent text-sm font-medium text-[#202124] focus:outline-none focus:bg-[#e8f0fe] px-2 py-1 rounded"
            placeholder="Untitled spreadsheet"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            File
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Edit
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            View
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Insert
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Format
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Data
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Tools
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Extensions
          </button>
          <button className="h-8 px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            Help
          </button>
        </div>

        <div className="ml-4 flex items-center gap-1">
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-full">
            <Undo2 size={18} />
          </button>
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-full">
            <Redo2 size={18} />
          </button>
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-full">
            <Printer size={18} />
          </button>
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-full">
            <ZoomIn size={18} />
          </button>
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-full">
            <ZoomOut size={18} />
          </button>
          <div className="mx-2 h-6 w-px bg-[#dadce0]" />
          <button className="h-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded px-2 text-sm font-medium">
            Share
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex h-12 items-center gap-1 border-b border-[#dadce0] bg-white px-3">
        <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded">
          <Undo2 size={18} />
        </button>
        <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded">
          <Redo2 size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-[#dadce0]" />

        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.bold ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ bold: !currentCellStyle.bold })}
        >
          <Bold size={18} />
        </button>
        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.italic ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ italic: !currentCellStyle.italic })}
        >
          <Italic size={18} />
        </button>
        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.underline ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ underline: !currentCellStyle.underline })}
        >
          <Underline size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-[#dadce0]" />

        <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded">
          <Type size={18} />
        </button>
        <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded">
          <Palette size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-[#dadce0]" />

        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.align === "left" ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ align: "left" })}
        >
          <AlignLeft size={18} />
        </button>
        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.align === "center" ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ align: "center" })}
        >
          <AlignCenter size={18} />
        </button>
        <button
          className={`h-8 w-8 grid place-items-center rounded ${currentCellStyle.align === "right" ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#5f6368] hover:bg-[#f1f3f4]"}`}
          onClick={() => applyFormat({ align: "right" })}
        >
          <AlignRight size={18} />
        </button>
        <div className="mx-1 h-6 w-px bg-[#dadce0]" />

        <div className="flex items-center gap-1 border border-[#dadce0] rounded bg-white">
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded-l">
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[#5f6368]">100%</span>
          <button className="h-8 w-8 grid place-items-center text-[#5f6368] hover:bg-[#f1f3f4] rounded">
            <ZoomOut size={18} />
          </button>
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex h-10 items-center gap-2 border-b border-[#dadce0] bg-white px-3">
        <div className="h-8 min-w-[80px] flex items-center justify-center border border-[#dadce0] bg-[#f8f9fa] rounded px-2 text-sm font-medium text-[#202124]">
          {selectedCell ? `${colName(selectedCell.col)}${selectedCell.row + 1}` : ""}
        </div>
        <div className="flex-1 flex items-center border border-transparent hover:border-[#dadce0] bg-[#f8f9fa] rounded h-8 px-2">
          <input
            type="text"
            value={formulaBarValue}
            onChange={(e) => setFormulaBarValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectedCell) {
                setWorkbook((prev) => {
                  const newSheets = [...prev.sheets];
                  const sheet = { ...newSheets[activeSheetIndex] };
                  const newRows = [...sheet.rows];
                  newRows[selectedCell.row] = [...newRows[selectedCell.row]];
                  newRows[selectedCell.row][selectedCell.col] = { ...newRows[selectedCell.row][selectedCell.col], v: formulaBarValue };
                  sheet.rows = newRows;
                  newSheets[activeSheetIndex] = sheet;
                  const newWorkbook = { ...prev, sheets: newSheets };
                  emit(newWorkbook);
                  return newWorkbook;
                });
              }
            }}
            className="flex-1 border-none bg-transparent text-sm text-[#202124] focus:outline-none"
            placeholder="Insert function (fx)"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0">
        <div className="ag-theme-quartz h-full">
          <AgGridReact
            ref={gridRef}
            rowData={rowData}
            columnDefs={columnDefs}
            gridOptions={gridOptions}
            rowSelection="multiple"
          />
        </div>
      </div>

      {/* Sheet tabs */}
      <div className="flex h-11 items-center gap-1 border-t border-[#dadce0] bg-[#f8f9fa] px-2">
        {workbook.sheets.map((sheet, i) => (
          <button
            key={i}
            onClick={() => setActiveSheetIndex(i)}
            className={`h-9 px-3 flex items-center justify-center text-sm font-medium rounded-t transition-colors ${
              i === activeSheetIndex
                ? "bg-white text-[#1a73e8] border-b-2 border-[#1a73e8] mt-1"
                : "text-[#5f6368] hover:bg-[#e8f0fe]"
            }`}
          >
            {sheet.name}
          </button>
        ))}
        <button
          onClick={addSheet}
          className="h-9 w-9 grid place-items-center text-[#5f6368] hover:bg-[#e8f0fe] rounded"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
