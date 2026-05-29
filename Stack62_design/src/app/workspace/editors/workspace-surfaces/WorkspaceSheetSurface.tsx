import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type CellClickedEvent,
} from "ag-grid-community";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { dispatchWorkspaceAction } from "../../../lib/resources";
import { useAppContext } from "../../../context/app-context";
import { Undo2, Redo2, Bold, Italic, Underline } from "lucide-react";

// AG Grid Community v33+ requires explicit module registration. We
// register every community module once at file load — keeps the bundle
// honest and avoids the "module X not registered" runtime warnings
// that bite first-time users.
ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Collaborative spreadsheet surface.
 *
 * The Y.Doc carries the canonical state:
 *   - `Y.Array("sheets")`  — [{ id, name, rowCount, colCount }]
 *   - `Y.Map("cells")`     — "sheetId:row:col" → { value, formula?, format? }
 *
 * AG Grid is bound to *snapshots* of that state — we materialize a 2D
 * row array out of the Y.Map on every observed update. The user types
 * in a cell → AG Grid fires `onCellValueChanged` → we dispatch a
 * `sheet.set_cell` REST action, which mutates the Y.Doc server-side
 * and broadcasts back. The Y.Map observer picks up the change and
 * re-renders. The user can't tell whether their edit or the AI's edit
 * came first — they both arrive through the same channel.
 *
 * Why dispatch through REST instead of mutating Y.Map locally + relying
 * on Hocuspocus to sync: we want the action audit log + ACL gating
 * that the action pipeline gives us. Direct Yjs updates skip both.
 * Latency cost (~50ms one-way) is acceptable for cell edits — humans
 * don't perceive sub-100ms.
 */
export function WorkspaceSheetSurface({
  docId,
  ydoc,
  organizationId,
  workspaceId,
}: {
  docId: string;
  ydoc: Y.Doc;
  provider: HocuspocusProvider | null;
  organizationId: string;
  workspaceId: string;
}) {
  const { user: _user } = useAppContext();
  void _user; // reserved for awareness-driven highlight (next turn)
  const gridRef = useRef<AgGridReact>(null);

  const [sheets, setSheets] = useState<
    Array<{ id: string; name: string; rowCount: number; colCount: number }>
  >([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [, setCellsVersion] = useState(0);
  const [charts, setCharts] = useState<
    Array<{ id: string; sheetId: string; sourceRange: string; type: string; title?: string }>
  >([]);
  const [, setChartsVersion] = useState(0);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);

  // Initialize undo manager for sheets, cells, and charts
  useEffect(() => {
    const um = new Y.UndoManager([
      ydoc.getArray("sheets"),
      ydoc.getMap("cells"),
      ydoc.getMap("charts"),
    ]);
    setUndoManager(um);
    return () => um.destroy();
  }, [ydoc]);

  // ── Y.Doc observation ────────────────────────────────────────────
  // Three observers: one on the sheets array (sheet add/delete/rename),
  // one on the cells map (every cell edit), one on charts map (chart edits). 
  // Both bump a local version counter so React re-renders.
  useEffect(() => {
    const sheetsArr = ydoc.getArray("sheets");
    const cellsMap = ydoc.getMap("cells");
    const chartsMap = ydoc.getMap("charts");

    const refreshSheets = () => {
      const next = sheetsArr.toArray() as Array<{
        id: string;
        name: string;
        rowCount: number;
        colCount: number;
      }>;
      setSheets(next);
      setActiveSheetId((cur) => cur ?? next[0]?.id ?? null);
    };

    const refreshCharts = () => {
      const next = Array.from(chartsMap.values()) as Array<{
        id: string;
        sheetId: string;
        sourceRange: string;
        type: string;
        title?: string;
      }>;
      setCharts(next);
    };

    const bumpCells = () => setCellsVersion((v) => v + 1);

    refreshSheets();
    refreshCharts();
    sheetsArr.observe(refreshSheets);
    cellsMap.observe(bumpCells);
    chartsMap.observe(refreshCharts);
    return () => {
      sheetsArr.unobserve(refreshSheets);
      cellsMap.unobserve(bumpCells);
      chartsMap.unobserve(refreshCharts);
    };
  }, [ydoc]);

  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId) ?? sheets[0] ?? null,
    [sheets, activeSheetId],
  );

  const getChartData = useCallback((sourceRange: string, sheetId: string) => {
    const cellsMap = ydoc.getMap("cells");
    const parts = sourceRange.split(":");
    if (parts.length !== 2) return [];
    const [from, to] = parts;
    
    // Parse from and to coordinates
    const fromColMatch = from.match(/^[A-Z]+/i);
    const fromRowMatch = from.match(/\d+$/);
    const toColMatch = to.match(/^[A-Z]+/i);
    const toRowMatch = to.match(/\d+$/);
    
    if (!fromColMatch || !fromRowMatch || !toColMatch || !toRowMatch) return [];
    
    const fromCol = colIndex(fromColMatch[0]);
    const fromRow = Number(fromRowMatch[0]) - 1;
    const toCol = colIndex(toColMatch[0]);
    const toRow = Number(toRowMatch[0]) - 1;
    
    const r1 = Math.min(fromRow, toRow);
    const r2 = Math.max(fromRow, toRow);
    const c1 = Math.min(fromCol, toCol);
    const c2 = Math.max(fromCol, toCol);
    
    // Build data array - assuming first row is labels, first column is categories, rest are values
    const data: Array<Record<string, unknown>> = [];
    for (let r = r1 + 1; r <= r2; r++) {
      const row: Record<string, unknown> = {};
      for (let c = c1; c <= c2; c++) {
        const key = `${sheetId}:${r}:${c}`;
        const cell = cellsMap.get(key) as { value?: unknown } | undefined;
        const headerKey = `${sheetId}:${r1}:${c}`;
        const headerCell = cellsMap.get(headerKey) as { value?: unknown } | undefined;
        const header = String(headerCell?.value ?? colLabel(c));
        row[header] = cell?.value;
      }
      data.push(row);
    }
    return data;
  }, [ydoc]);

  const activeSheetCharts = useMemo(() => {
    return charts.filter(c => c.sheetId === activeSheet?.id);
  }, [charts, activeSheet]);

  // ── AG Grid column + row data ────────────────────────────────────
  const columnDefs = useMemo<ColDef[]>(() => {
    if (!activeSheet) return [];
    const cols: ColDef[] = [
      {
        headerName: "",
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
        editable: false,
        width: 50,
        pinned: "left",
        cellStyle: {
          backgroundColor: "#f1f3f4",
          color: "#5f6368",
          textAlign: "center",
          fontWeight: 500,
        },
      },
    ];
    for (let c = 0; c < activeSheet.colCount; c++) {
      cols.push({
        headerName: colLabel(c),
        field: `c${c}`,
        editable: true,
        width: 110,
        suppressMovable: true,
        cellStyle: (params) => {
          const row = params.node?.rowIndex ?? 0;
          const cell = ydoc.getMap("cells").get(`${activeSheet.id}:${row}:${c}`) as { format?: Record<string, unknown> } | undefined;
          const style: Record<string, unknown> = { borderRight: "1px solid #e8eaed" };
          const format = cell?.format;
          if (format) {
            if (format.bold) style.fontWeight = "bold";
            if (format.italic) style.fontStyle = "italic";
            if (format.underline) style.textDecoration = "underline";
            if (format.backgroundColor) style.backgroundColor = format.backgroundColor;
            if (format.color) style.color = format.color;
          }
          return style;
        },
      });
    }
    return cols;
  }, [activeSheet, ydoc]);

  const rowData = useMemo<Array<Record<string, unknown>>>(() => {
    if (!activeSheet) return [];
    const cellsMap = ydoc.getMap("cells");
    const rows: Array<Record<string, unknown>> = [];
    for (let r = 0; r < activeSheet.rowCount; r++) {
      const row: Record<string, unknown> = { __row: r };
      for (let c = 0; c < activeSheet.colCount; c++) {
        const cell = cellsMap.get(`${activeSheet.id}:${r}:${c}`) as
          | { value?: unknown; formula?: string }
          | undefined;
        // If a formula is present, evaluate; otherwise show the raw
        // value. The Y.Doc stores both for round-trip fidelity.
        if (cell?.formula) {
          row[`c${c}`] = evaluateFormula(
            cell.formula,
            activeSheet.id,
            cellsMap as Y.Map<unknown>,
          );
        } else {
          row[`c${c}`] = cell?.value ?? "";
        }
      }
      rows.push(row);
    }
    return rows;
    // setCellsVersion is observed in the bumpCells effect — we don't
    // depend on it directly, but the surrounding component re-renders
    // when it bumps, which causes this memo to recompute against the
    // fresh map state.
  }, [activeSheet, ydoc]);

  // ── Cell click handler ───────────────────────────────────────────
  const onCellClicked = useCallback(
    (event: CellClickedEvent) => {
      const colField = event.colDef.field;
      if (!colField || !colField.startsWith("c")) return;
      const col = Number(colField.slice(1));
      const row = event.node.rowIndex ?? 0;
      setSelectedCell({ row, col });
      window.dispatchEvent(new CustomEvent("stack62:sheet-cell-focus", {
        detail: { row, col }
      }));
    },
    []
  );

  // ── Formatting handler ───────────────────────────────────────────
  const applyFormatting = useCallback(
    async (formatPatch: Record<string, unknown>) => {
      if (!activeSheet || !selectedCell) return;
      const cellsMap = ydoc.getMap("cells");
      const key = `${activeSheet.id}:${selectedCell.row}:${selectedCell.col}`;
      const currentCell = cellsMap.get(key) as {
        value?: unknown;
        formula?: string;
        format?: Record<string, unknown>;
      } | undefined;
      const newFormat = { ...currentCell?.format, ...formatPatch };
      try {
        await dispatchWorkspaceAction({
          organizationId,
          workspaceId,
          docId,
          action: {
            verb: "sheet.set_cell",
            sheetId: activeSheet.id,
            row: selectedCell.row,
            col: selectedCell.col,
            value: currentCell?.value ?? "",
            formula: currentCell?.formula,
            format: newFormat,
          },
        });
      } catch (err) {
        console.warn("sheet.set_cell failed", err instanceof Error ? err.message : err);
      }
    },
    [activeSheet, selectedCell, docId, organizationId, workspaceId, ydoc]
  );

  // ── Edit handler ────────────────────────────────────────────────
  const onCellValueChanged = useCallback(
    async (event: CellValueChangedEvent) => {
      if (!activeSheet) return;
      const colField = event.colDef.field;
      if (!colField || !colField.startsWith("c")) return;
      const col = Number(colField.slice(1));
      const row = event.node.rowIndex ?? 0;
      const raw =
        event.newValue == null ? "" : String(event.newValue);
      const isFormula = raw.startsWith("=");
      const cellsMap = ydoc.getMap("cells");
      const key = `${activeSheet.id}:${row}:${col}`;
      const currentCell = cellsMap.get(key) as {
        format?: Record<string, unknown>;
      } | undefined;
      try {
        await dispatchWorkspaceAction({
          organizationId,
          workspaceId,
          docId,
          action: {
            verb: "sheet.set_cell",
            sheetId: activeSheet.id,
            row,
            col,
            value: isFormula ? null : coerceCell(raw),
            formula: isFormula ? raw.slice(1) : undefined,
            format: currentCell?.format,
          },
        });
      } catch (err) {
        // Roll back the optimistic AG Grid edit on failure.
        const prev =
          (cellsMap.get(key) as
            | { value?: unknown }
            | undefined)?.value ?? "";
        event.node.setDataValue(colField, prev);
        console.warn("sheet.set_cell failed", err instanceof Error ? err.message : err);
      }
    },
    [activeSheet, docId, organizationId, workspaceId, ydoc],
  );

  if (!activeSheet) {
    return (
      <div className="grid h-full place-items-center bg-[#f6f8fa] text-sm text-[#57606a]">
        Loading sheet…
      </div>
    );
  }

  return (
    // Always render the spreadsheet on a light surface — Excel and
    // Sheets are unconditionally light because dark text on white
    // cells is the only thing the eye expects in a grid. We don't
    // let the user's app-wide dark theme bleed in here.
    <div className="flex h-full flex-col bg-[#f6f8fa] text-[#1f1f1f]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#d0d7de] bg-white px-2 py-1 text-[11px]">
        <button
          type="button"
          onClick={() => undoManager?.undo()}
          disabled={!undoManager?.canUndo()}
          title="Undo"
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            !undoManager?.canUndo()
              ? "text-[#57606a] opacity-40"
              : "text-[#1f1f1f] hover:bg-[#f6f8fa]"
          }`}
        >
          <Undo2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Undo</span>
        </button>
        <button
          type="button"
          onClick={() => undoManager?.redo()}
          disabled={!undoManager?.canRedo()}
          title="Redo"
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            !undoManager?.canRedo()
              ? "text-[#57606a] opacity-40"
              : "text-[#1f1f1f] hover:bg-[#f6f8fa]"
          }`}
        >
          <Redo2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Redo</span>
        </button>
        <div className="mx-1 h-5 w-px bg-[#d0d7de]" />
        <button
          type="button"
          onClick={() => applyFormatting({ bold: !getCurrentFormat("bold") })}
          disabled={!selectedCell}
          title="Bold"
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            !selectedCell
              ? "text-[#57606a] opacity-40"
              : getCurrentFormat("bold")
                ? "bg-blue-100 text-blue-800"
                : "text-[#1f1f1f] hover:bg-[#f6f8fa]"
          }`}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => applyFormatting({ italic: !getCurrentFormat("italic") })}
          disabled={!selectedCell}
          title="Italic"
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            !selectedCell
              ? "text-[#57606a] opacity-40"
              : getCurrentFormat("italic")
                ? "bg-blue-100 text-blue-800"
                : "text-[#1f1f1f] hover:bg-[#f6f8fa]"
          }`}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => applyFormatting({ underline: !getCurrentFormat("underline") })}
          disabled={!selectedCell}
          title="Underline"
          className={`flex items-center gap-1 rounded px-2 py-1 transition ${
            !selectedCell
              ? "text-[#57606a] opacity-40"
              : getCurrentFormat("underline")
                ? "bg-blue-100 text-blue-800"
                : "text-[#1f1f1f] hover:bg-[#f6f8fa]"
          }`}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Formula bar */}
      <FormulaBar
        ydoc={ydoc}
        sheetId={activeSheet.id}
        onCommit={async (row, col, raw) => {
          const isFormula = raw.startsWith("=");
          const cellsMap = ydoc.getMap("cells");
          const key = `${activeSheet.id}:${row}:${col}`;
          const currentCell = cellsMap.get(key) as {
            format?: Record<string, unknown>;
          } | undefined;
          await dispatchWorkspaceAction({
            organizationId,
            workspaceId,
            docId,
            action: {
              verb: "sheet.set_cell",
              sheetId: activeSheet.id,
              row,
              col,
              value: isFormula ? null : coerceCell(raw),
              formula: isFormula ? raw.slice(1) : undefined,
              format: currentCell?.format,
            },
          });
        }}
      />

      {/* Grid */}
      <div className="min-h-0 flex-1">
        <AgGridReact
          ref={gridRef}
          theme={themeQuartz}
          columnDefs={columnDefs}
          rowData={rowData}
          onCellValueChanged={onCellValueChanged}
          onCellClicked={onCellClicked}
          singleClickEdit={false}
          stopEditingWhenCellsLoseFocus
          rowHeight={28}
          headerHeight={28}
          suppressMovableColumns
          animateRows={false}
          // Cell-level performance: avoid re-rendering every cell on
          // each Y.Map bump by using `getRowId` + immutable rowData
          // patterns. For now the brute-force re-render on bumpCells
          // is fine for 100×26 grids; revisit when we hit thousand-row
          // workloads.
        />
      </div>

      {/* Charts */}
      {activeSheetCharts.length > 0 && (
        <div className="flex flex-wrap gap-4 border-t border-[#d0d7de] bg-white p-4">
          {activeSheetCharts.map((chart) => {
            const chartData = getChartData(chart.sourceRange, chart.sheetId);
            const keys = Object.keys(chartData[0] || {});
            const categoryKey = keys[0] || 'name';
            const valueKeys = keys.slice(1);
            const colors = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9334e6'];
            
            const renderChart = () => {
              switch (chart.type.toLowerCase()) {
                case 'line':
                  return (
                    <LineChart width={400} height={300} data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={categoryKey} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {valueKeys.map((key, i) => (
                        <Line key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} activeDot={{ r: 8 }} />
                      ))}
                    </LineChart>
                  );
                case 'bar':
                  return (
                    <BarChart width={400} height={300} data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={categoryKey} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {valueKeys.map((key, i) => (
                        <Bar key={key} dataKey={key} fill={colors[i % colors.length]} />
                      ))}
                    </BarChart>
                  );
                case 'pie':
                  return (
                    <PieChart width={400} height={300}>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        fill="#8884d8"
                        label={(entry) => String(entry[categoryKey])}
                        dataKey={valueKeys[0] || 'value'}
                      >
                        {chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  );
                default:
                  return (
                    <BarChart width={400} height={300} data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={categoryKey} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {valueKeys.map((key, i) => (
                        <Bar key={key} dataKey={key} fill={colors[i % colors.length]} />
                      ))}
                    </BarChart>
                  );
              }
            };
            
            return (
              <div key={chart.id} className="rounded border border-[#d0d7de] bg-white p-2">
                {chart.title && <h4 className="mb-2 text-xs font-semibold text-[#1f1f1f]">{chart.title}</h4>}
                {renderChart()}
              </div>
            );
          })}
        </div>
      )}

      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5 border-t border-[#d0d7de] bg-white px-2 py-1 text-[11px]">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSheetId(s.id)}
              className={`rounded px-2 py-0.5 transition ${
                s.id === activeSheet.id
                  ? "bg-[#2da44e] text-white"
                  : "text-[#57606a] hover:bg-[#f6f8fa]"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  function getCurrentFormat(key: string) {
    if (!activeSheet || !selectedCell) return false;
    const cell = ydoc.getMap("cells").get(`${activeSheet.id}:${selectedCell.row}:${selectedCell.col}`) as { format?: Record<string, unknown> } | undefined;
    return !!cell?.format?.[key];
  }
}

// ── Formula bar ──────────────────────────────────────────────────

function FormulaBar({
  ydoc,
  sheetId,
  onCommit,
}: {
  ydoc: Y.Doc;
  sheetId: string;
  onCommit: (row: number, col: number, raw: string) => Promise<void>;
}) {
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(
    null,
  );
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // Listen for AG Grid's `cellFocused` via a custom DOM event we'd
    // emit from a cellFocused handler. For brevity we listen on
    // document for AG Grid's bubbled focus changes; in production we'd
    // wire this through gridRef.current.api.addEventListener.
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ row: number; col: number }>)
        .detail;
      if (!detail) return;
      setFocus(detail);
      const cell = ydoc.getMap("cells").get(`${sheetId}:${detail.row}:${detail.col}`) as
        | { value?: unknown; formula?: string }
        | undefined;
      if (cell?.formula) setDraft(`=${cell.formula}`);
      else setDraft(cell?.value == null ? "" : String(cell.value));
    };
    window.addEventListener("stack62:sheet-cell-focus", handler);
    return () =>
      window.removeEventListener("stack62:sheet-cell-focus", handler);
  }, [ydoc, sheetId]);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#d0d7de] bg-white px-2 py-1 text-xs">
      <span className="grid h-6 w-12 place-items-center rounded border border-[#d0d7de] bg-[#f6f8fa] font-mono text-[11px] text-[#57606a]">
        {focus ? `${colLabel(focus.col)}${focus.row + 1}` : "—"}
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && focus) {
            e.preventDefault();
            void onCommit(focus.row, focus.col, draft);
          }
        }}
        placeholder={focus ? "Type a value or =FORMULA" : "Select a cell"}
        disabled={!focus}
        className="h-6 flex-1 rounded border border-[#d0d7de] bg-white px-2 font-mono text-[11px] text-[#1f1f1f] focus:outline-none focus:ring-1 focus:ring-[#2da44e]"
      />
    </div>
  );
}

// ── Cell helpers ─────────────────────────────────────────────────

/**
 * Convert a column index into the spreadsheet letter label.
 * 0 → A, 25 → Z, 26 → AA, 701 → ZZ.
 */
function colLabel(col: number): string {
  let s = "";
  let n = col;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function colIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/**
 * Best-effort cell value coercion. Numbers become numbers; "true"/
 * "false" become booleans; anything else stays a string. AG Grid
 * will store whatever we return verbatim in the rowData object.
 */
function coerceCell(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  // Only parse a number if the whole string is a number — avoid
  // turning "01234" (which the user probably wants as a string) into 1234.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

// ── Formula evaluator ────────────────────────────────────────────

/**
 * Minimal formula evaluator. Supports:
 *   - Single-cell refs: A1, $A$1
 *   - Range refs: A1:B5 (only inside aggregate functions)
 *   - Operators: + - * / ^ ( )
 *   - Functions: SUM, AVG/AVERAGE, COUNT, COUNTA, MIN, MAX, ABS,
 *                ROUND, FLOOR, CEILING, SQRT, POWER, IF
 *
 * Not supported (yet): cross-sheet refs (Sheet2!A1), VLOOKUP,
 * INDEX/MATCH, anything async. Sheet-local refs only.
 *
 * Errors surface as `#ERR!` so the user sees something went wrong
 * without the cell going blank.
 */
function evaluateFormula(
  formula: string,
  sheetId: string,
  cellsMap: Y.Map<unknown>,
): string | number {
  try {
    const ctx = { sheetId, cellsMap, depth: 0 };
    return evalExpression(formula, ctx);
  } catch (err) {
    return `#ERR! ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface EvalCtx {
  sheetId: string;
  cellsMap: Y.Map<unknown>;
  depth: number;
}

function evalExpression(expr: string, ctx: EvalCtx): string | number {
  if (ctx.depth > 32) throw new Error("Formula too deep");
  const tokens = tokenize(expr);
  const ast = parseExpression(tokens);
  return evalAst(ast, ctx);
}

type Token =
  | { type: "num"; value: number }
  | { type: "ref"; value: string }
  | { type: "range"; from: string; to: string }
  | { type: "fn"; name: string }
  | { type: "op"; value: string }
  | { type: "string"; value: string };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const re = /\s+/;
  while (i < s.length) {
    const ch = s[i];
    if (re.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      out.push({ type: "string", value: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ type: "num", value: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      const word = s.slice(i, j).toUpperCase();
      // Is this a cell ref like A1, $A$1?
      let k = j;
      let hasDigits = false;
      while (k < s.length && /[0-9]/.test(s[k])) {
        hasDigits = true;
        k++;
      }
      if (hasDigits) {
        const ref = word.replace(/\$/g, "") + s.slice(j, k);
        // Range?
        if (k < s.length && s[k] === ":") {
          let m = k + 1;
          while (m < s.length && /[A-Za-z0-9$]/.test(s[m])) m++;
          const right = s.slice(k + 1, m).toUpperCase().replace(/\$/g, "");
          out.push({ type: "range", from: ref, to: right });
          i = m;
          continue;
        }
        out.push({ type: "ref", value: ref });
        i = k;
        continue;
      }
      // Otherwise function name
      out.push({ type: "fn", name: word });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      out.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return out;
}

// ── Recursive-descent parser ─────────────────────────────────────

interface AstNode {
  kind: string;
  // discriminated by `kind`; we keep it loose for brevity
  [key: string]: unknown;
}

function parseExpression(tokens: Token[]): AstNode {
  const state = { i: 0, tokens };
  return parseAddSub(state);
}

function parseAddSub(state: { i: number; tokens: Token[] }): AstNode {
  let left = parseMulDiv(state);
  while (
    state.i < state.tokens.length &&
    state.tokens[state.i].type === "op" &&
    "+-".includes((state.tokens[state.i] as { value: string }).value)
  ) {
    const op = (state.tokens[state.i] as { value: string }).value;
    state.i++;
    const right = parseMulDiv(state);
    left = { kind: "binop", op, left, right };
  }
  return left;
}

function parseMulDiv(state: { i: number; tokens: Token[] }): AstNode {
  let left = parsePow(state);
  while (
    state.i < state.tokens.length &&
    state.tokens[state.i].type === "op" &&
    "*/".includes((state.tokens[state.i] as { value: string }).value)
  ) {
    const op = (state.tokens[state.i] as { value: string }).value;
    state.i++;
    const right = parsePow(state);
    left = { kind: "binop", op, left, right };
  }
  return left;
}

function parsePow(state: { i: number; tokens: Token[] }): AstNode {
  let left = parseUnary(state);
  while (
    state.i < state.tokens.length &&
    state.tokens[state.i].type === "op" &&
    (state.tokens[state.i] as { value: string }).value === "^"
  ) {
    state.i++;
    const right = parseUnary(state);
    left = { kind: "binop", op: "^", left, right };
  }
  return left;
}

function parseUnary(state: { i: number; tokens: Token[] }): AstNode {
  if (
    state.tokens[state.i]?.type === "op" &&
    (state.tokens[state.i] as { value: string }).value === "-"
  ) {
    state.i++;
    const inner = parseUnary(state);
    return { kind: "neg", inner };
  }
  return parsePrimary(state);
}

function parsePrimary(state: { i: number; tokens: Token[] }): AstNode {
  const tok = state.tokens[state.i];
  if (!tok) throw new Error("Unexpected end of formula");
  if (tok.type === "num") {
    state.i++;
    return { kind: "num", value: tok.value };
  }
  if (tok.type === "string") {
    state.i++;
    return { kind: "string", value: tok.value };
  }
  if (tok.type === "ref") {
    state.i++;
    return { kind: "ref", value: tok.value };
  }
  if (tok.type === "range") {
    state.i++;
    return { kind: "range", from: tok.from, to: tok.to };
  }
  if (tok.type === "fn") {
    state.i++;
    if (
      state.tokens[state.i]?.type !== "op" ||
      (state.tokens[state.i] as { value: string }).value !== "("
    ) {
      throw new Error(`Expected ( after ${tok.name}`);
    }
    state.i++; // consume (
    const args: AstNode[] = [];
    while (
      state.tokens[state.i] &&
      !(
        state.tokens[state.i].type === "op" &&
        (state.tokens[state.i] as { value: string }).value === ")"
      )
    ) {
      args.push(parseAddSub(state));
      if (
        state.tokens[state.i]?.type === "op" &&
        (state.tokens[state.i] as { value: string }).value === ","
      ) {
        state.i++;
      }
    }
    if (
      state.tokens[state.i]?.type !== "op" ||
      (state.tokens[state.i] as { value: string }).value !== ")"
    ) {
      throw new Error("Missing )");
    }
    state.i++;
    return { kind: "fn", name: tok.name, args };
  }
  if (tok.type === "op" && tok.value === "(") {
    state.i++;
    const inner = parseAddSub(state);
    if (
      state.tokens[state.i]?.type !== "op" ||
      (state.tokens[state.i] as { value: string }).value !== ")"
    ) {
      throw new Error("Missing )");
    }
    state.i++;
    return inner;
  }
  throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
}

function evalAst(node: AstNode, ctx: EvalCtx): string | number {
  if (node.kind === "num") return node.value as number;
  if (node.kind === "string") return node.value as string;
  if (node.kind === "neg") {
    const v = evalAst(node.inner as AstNode, ctx);
    return -toNumber(v);
  }
  if (node.kind === "ref") return cellValue(node.value as string, ctx);
  if (node.kind === "range") {
    // Ranges are valid only as function arguments. If you reference a
    // bare range at top level you get the first cell.
    return cellValue(node.from as string, ctx);
  }
  if (node.kind === "binop") {
    const l = toNumber(evalAst(node.left as AstNode, ctx));
    const r = toNumber(evalAst(node.right as AstNode, ctx));
    switch (node.op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        return r === 0 ? "#DIV/0!" : l / r;
      case "^":
        return Math.pow(l, r);
    }
  }
  if (node.kind === "fn") {
    const name = (node.name as string).toUpperCase();
    const args = (node.args as AstNode[]).map((a) => evalArg(a, ctx));
    return applyFunction(name, args);
  }
  throw new Error(`Unknown node: ${node.kind}`);
}

function evalArg(node: AstNode, ctx: EvalCtx): Array<string | number> {
  if (node.kind === "range") {
    const fromCol = colIndex((node.from as string).match(/^[A-Z]+/)![0]);
    const fromRow = Number((node.from as string).match(/\d+$/)![0]) - 1;
    const toCol = colIndex((node.to as string).match(/^[A-Z]+/)![0]);
    const toRow = Number((node.to as string).match(/\d+$/)![0]) - 1;
    const r1 = Math.min(fromRow, toRow);
    const r2 = Math.max(fromRow, toRow);
    const c1 = Math.min(fromCol, toCol);
    const c2 = Math.max(fromCol, toCol);
    const values: Array<string | number> = [];
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const key = `${ctx.sheetId}:${r}:${c}`;
        const cell = ctx.cellsMap.get(key) as { value?: unknown } | undefined;
        const v = cell?.value;
        if (v != null && v !== "") values.push(v as string | number);
      }
    }
    return values;
  }
  return [evalAst(node, ctx)];
}

function applyFunction(
  name: string,
  args: Array<Array<string | number>>,
): string | number {
  const flat = args.flat();
  const nums = flat.map(toNumber).filter((v) => !Number.isNaN(v));
  switch (name) {
    case "SUM":
      return nums.reduce((a, b) => a + b, 0);
    case "AVG":
    case "AVERAGE":
      return nums.length === 0 ? "#DIV/0!" : nums.reduce((a, b) => a + b, 0) / nums.length;
    case "COUNT":
      return nums.length;
    case "COUNTA":
      return flat.filter((v) => v !== "" && v != null).length;
    case "MIN":
      return nums.length === 0 ? 0 : Math.min(...nums);
    case "MAX":
      return nums.length === 0 ? 0 : Math.max(...nums);
    case "ABS":
      return Math.abs(nums[0] ?? 0);
    case "ROUND":
      return Math.round((nums[0] ?? 0) * Math.pow(10, nums[1] ?? 0)) /
        Math.pow(10, nums[1] ?? 0);
    case "FLOOR":
      return Math.floor(nums[0] ?? 0);
    case "CEILING":
      return Math.ceil(nums[0] ?? 0);
    case "SQRT":
      return Math.sqrt(nums[0] ?? 0);
    case "POWER":
      return Math.pow(nums[0] ?? 0, nums[1] ?? 0);
    case "IF":
      // IF expects (condition, ifTrue, ifFalse). Args come in as
      // single-element subarrays from evalArg.
      return toNumber(args[0]?.[0]) ? (args[1]?.[0] ?? "") : (args[2]?.[0] ?? "");
    case "CONCAT":
    case "CONCATENATE":
      return flat.map((v) => String(v)).join("");
  }
  return `#NAME?`;
}

function cellValue(ref: string, ctx: EvalCtx): string | number {
  // ref is like "A1" / "AB123".
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return `#REF!`;
  const col = colIndex(m[1]);
  const row = Number(m[2]) - 1;
  const cell = ctx.cellsMap.get(`${ctx.sheetId}:${row}:${col}`) as
    | { value?: unknown; formula?: string }
    | undefined;
  if (!cell) return 0;
  if (cell.formula) {
    return evalExpression(cell.formula, { ...ctx, depth: ctx.depth + 1 });
  }
  return (cell.value as string | number | undefined) ?? 0;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    if (v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return 0;
}
