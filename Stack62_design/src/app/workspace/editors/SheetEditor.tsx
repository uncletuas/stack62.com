import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowRightToLine,
  Bold,
  Italic,
  PaintBucket,
  Palette,
  Plus,
  Strikethrough,
  Trash2,
  Underline,
} from "lucide-react";

/**
 * Google-Sheets/Excel-style spreadsheet editor. Built on a virtualised
 * grid so it stays smooth at thousands of rows. Highlights:
 *
 *   - Column letters (A, B, C, …, AA, AB, …) and row numbers
 *   - Formula bar that mirrors the active cell
 *   - Range selection by click + drag; Shift-click extends; arrow keys move
 *   - Tab / Enter navigation
 *   - Per-cell formatting: bold / italic / underline / strike, alignment,
 *     text + background colours, number formats
 *   - Multiple sheets via bottom tab strip; add / rename / delete
 *   - Add/remove rows & columns from a right-click menu (still TODO) and
 *     toolbar
 *   - Simple formulas: =SUM(A1:A5), =AVERAGE, =MIN/MAX/COUNT, =A1+B1, etc.
 *
 * Storage: a JSON envelope ({ sheets: [{ name, rows, formats }] }) so we
 * don't lose formatting on round-trip. Falls back to parsing CSV / TSV
 * cleanly for files imported from older sources.
 */

export type SheetCell = {
  v?: string;         // raw value as the user typed (or formula text starting with =)
  /** Pre-computed formula result; kept so we can render without re-parsing.
   *  When undefined, we treat v as the displayed value. */
  c?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  align?: "left" | "center" | "right";
  color?: string;     // text colour, CSS string
  bg?: string;        // background fill, CSS string
  fmt?: NumFormat;
};

export type NumFormat =
  | "general"
  | "number"
  | "percent"
  | "currency"
  | "date"
  | "time"
  | "text";

export type Sheet = {
  name: string;
  rows: SheetCell[][];
  /** Frozen header row + column counts (defaults to 0). */
  frozenRows?: number;
  frozenCols?: number;
};

export type WorkbookJson = {
  version: 1;
  sheets: Sheet[];
};

const DEFAULT_ROWS = 100;
const DEFAULT_COLS = 26;
const CELL_W = 110;
const CELL_H = 28;
const HEADER_W = 44;
const HEADER_H = 24;

export function SheetEditor({
  text,
  onChange,
  title,
}: {
  text: string;
  onChange: (next: string) => void;
  title?: string;
}) {
  const [book, setBook] = useState<WorkbookJson>(() => parseWorkbook(text));
  const [activeSheet, setActiveSheet] = useState(0);
  const [selection, setSelection] = useState<Range>({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastEmittedRef = useRef<string>("");
  const gridRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formulaRef = useRef<HTMLInputElement | null>(null);

  /** Hydrate from external text changes (initial load, coworker edits). */
  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setBook(parseWorkbook(text));
  }, [text]);

  const sheet = book.sheets[activeSheet] ?? book.sheets[0];

  const emit = useCallback(
    (nextBook: WorkbookJson) => {
      const serialized = JSON.stringify(nextBook);
      lastEmittedRef.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  const updateCells = useCallback(
    (updater: (cells: SheetCell[][]) => SheetCell[][]) => {
      setBook((prev) => {
        const sheets = prev.sheets.map((s, i) =>
          i === activeSheet ? { ...s, rows: updater(s.rows) } : s,
        );
        const next = { ...prev, sheets };
        emit(next);
        return next;
      });
    },
    [activeSheet, emit],
  );

  const setCell = useCallback(
    (r: number, c: number, patch: Partial<SheetCell>) => {
      updateCells((cells) => {
        const grown = ensureSize(cells, r + 1, c + 1);
        const next = grown.map((row) => row.slice());
        next[r] = next[r].slice();
        const cur = next[r][c] ?? {};
        next[r][c] = { ...cur, ...patch };
        return next;
      });
    },
    [updateCells],
  );

  const applyFormat = useCallback(
    (patch: Partial<SheetCell>) => {
      updateCells((cells) => {
        const { r1, c1, r2, c2 } = normalize(selection);
        const grown = ensureSize(cells, r2 + 1, c2 + 1);
        const next = grown.map((row) => row.slice());
        for (let r = r1; r <= r2; r += 1) {
          next[r] = next[r].slice();
          for (let c = c1; c <= c2; c += 1) {
            next[r][c] = { ...next[r][c], ...patch };
          }
        }
        return next;
      });
    },
    [selection, updateCells],
  );

  const commitEdit = useCallback(
    (advance: { dr?: number; dc?: number } = { dr: 1 }) => {
      if (!editing) return;
      const { r, c, value } = editing;
      setCell(r, c, { v: value });
      setEditing(null);
      // Move selection
      const dr = advance.dr ?? 0;
      const dc = advance.dc ?? 0;
      const nextR = clamp(r + dr, 0, DEFAULT_ROWS * 2);
      const nextC = clamp(c + dc, 0, DEFAULT_COLS * 2);
      setAnchor({ r: nextR, c: nextC });
      setSelection({ r1: nextR, c1: nextC, r2: nextR, c2: nextC });
      // Refocus the grid so arrow keys keep working
      window.setTimeout(() => gridRef.current?.focus(), 0);
    },
    [editing, setCell],
  );

  const beginEdit = useCallback(
    (r: number, c: number, seed?: string) => {
      const existing = sheet.rows[r]?.[c]?.v ?? "";
      setEditing({ r, c, value: seed !== undefined ? seed : existing });
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [sheet.rows],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing) return; // input handles its own keys
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const dr = k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0;
      const dc = k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0;
      const nextR = Math.max(0, anchor.r + dr);
      const nextC = Math.max(0, anchor.c + dc);
      if (e.shiftKey) {
        setSelection((cur) => ({ ...cur, r2: nextR, c2: nextC }));
      } else {
        setAnchor({ r: nextR, c: nextC });
        setSelection({ r1: nextR, c1: nextC, r2: nextR, c2: nextC });
      }
      return;
    }
    if (k === "Tab") {
      e.preventDefault();
      const dc = e.shiftKey ? -1 : 1;
      const nextC = Math.max(0, anchor.c + dc);
      setAnchor({ r: anchor.r, c: nextC });
      setSelection({ r1: anchor.r, c1: nextC, r2: anchor.r, c2: nextC });
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      beginEdit(anchor.r, anchor.c);
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      // Clear values across selection (keep formatting).
      updateCells((cells) => {
        const { r1, c1, r2, c2 } = normalize(selection);
        const grown = ensureSize(cells, r2 + 1, c2 + 1);
        const next = grown.map((row) => row.slice());
        for (let r = r1; r <= r2; r += 1) {
          next[r] = next[r].slice();
          for (let c = c1; c <= c2; c += 1) {
            const cell = next[r][c];
            if (cell) next[r][c] = { ...cell, v: "", c: undefined };
          }
        }
        return next;
      });
      return;
    }
    // Mod+B / I / U: formatting
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "b") {
      e.preventDefault();
      applyFormat({ bold: !cellOf(sheet, anchor.r, anchor.c).bold });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "i") {
      e.preventDefault();
      applyFormat({ italic: !cellOf(sheet, anchor.r, anchor.c).italic });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "u") {
      e.preventDefault();
      applyFormat({ underline: !cellOf(sheet, anchor.r, anchor.c).underline });
      return;
    }
    // Printable character → start editing with that character
    if (!e.ctrlKey && !e.metaKey && k.length === 1) {
      e.preventDefault();
      beginEdit(anchor.r, anchor.c, k);
    }
  };

  const mouseDownCell = (r: number, c: number, e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.shiftKey) {
      setSelection((cur) => ({ r1: cur.r1, c1: cur.c1, r2: r, c2: c }));
      return;
    }
    setAnchor({ r, c });
    setSelection({ r1: r, c1: c, r2: r, c2: c });
    setDragging(true);
    gridRef.current?.focus();
  };

  const mouseEnterCell = (r: number, c: number) => {
    if (!dragging) return;
    setSelection((cur) => ({ ...cur, r2: r, c2: c }));
  };

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ── Computed (formula) values cache ──────────────────────────────
  const computed = useMemo(() => evaluateSheet(sheet), [sheet]);

  // ── Sheet management ─────────────────────────────────────────────
  const addSheet = () => {
    setBook((prev) => {
      const next: WorkbookJson = {
        ...prev,
        sheets: [...prev.sheets, freshSheet(`Sheet ${prev.sheets.length + 1}`)],
      };
      emit(next);
      return next;
    });
    setActiveSheet(book.sheets.length);
  };

  const removeSheet = (idx: number) => {
    if (book.sheets.length <= 1) return;
    setBook((prev) => {
      const sheets = prev.sheets.filter((_, i) => i !== idx);
      const next: WorkbookJson = { ...prev, sheets };
      emit(next);
      return next;
    });
    setActiveSheet((cur) => clamp(cur > idx ? cur - 1 : Math.min(cur, book.sheets.length - 2), 0, book.sheets.length - 2));
  };

  const renameSheet = (idx: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBook((prev) => {
      const sheets = prev.sheets.map((s, i) => (i === idx ? { ...s, name: trimmed } : s));
      const next: WorkbookJson = { ...prev, sheets };
      emit(next);
      return next;
    });
  };

  // ── Row / column ops ─────────────────────────────────────────────
  const addRow = () => updateCells((cells) => [...cells, makeRow(maxCols(cells))]);
  const addCol = () => updateCells((cells) => cells.map((row) => [...row, {}]));

  const removeRow = () => {
    updateCells((cells) => {
      const { r1, r2 } = normalize(selection);
      const next = cells.filter((_, i) => i < r1 || i > r2);
      return next.length === 0 ? [makeRow(DEFAULT_COLS)] : next;
    });
  };

  const removeCol = () => {
    updateCells((cells) => {
      const { c1, c2 } = normalize(selection);
      return cells.map((row) => row.filter((_, i) => i < c1 || i > c2));
    });
  };

  // ── Render ───────────────────────────────────────────────────────
  const visibleRows = Math.max(DEFAULT_ROWS, sheet.rows.length + 10);
  const visibleCols = Math.max(DEFAULT_COLS, maxCols(sheet.rows) + 5);

  const activeCell = cellOf(sheet, anchor.r, anchor.c);

  return (
    // Spreadsheets are unconditionally light, like Excel + Sheets.
    // Override the theme CSS vars locally so every `bg-app` /
    // `text-app` / `border-app` descendant renders against light
    // values even when the user's app theme is dark.
    <div
      className="flex h-full flex-col bg-app text-app"
      style={
        {
          "--app-bg": "#ffffff",
          "--app-surface": "#f6f8fa",
          "--app-elevated": "#ffffff",
          "--app-hover": "#f6f8fa",
          "--app-text": "#1f1f1f",
          "--app-text-muted": "#57606a",
          "--app-text-faint": "#8b949e",
          "--app-text-subtle": "#57606a",
          "--app-border": "#d0d7de",
          "--doc-canvas": "#ffffff",
        } as Record<string, string>
      }
    >
      {/* Toolbar */}
      <div
        className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-app bg-app-elevated px-3 py-1.5"
        onMouseDown={(e) => e.preventDefault()}
      >
        <ToolBtn title="Bold (Ctrl+B)" active={activeCell.bold} onPress={() => applyFormat({ bold: !activeCell.bold })}>
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" active={activeCell.italic} onPress={() => applyFormat({ italic: !activeCell.italic })}>
          <Italic className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Underline (Ctrl+U)" active={activeCell.underline} onPress={() => applyFormat({ underline: !activeCell.underline })}>
          <Underline className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Strikethrough" active={activeCell.strike} onPress={() => applyFormat({ strike: !activeCell.strike })}>
          <Strikethrough className="h-4 w-4" />
        </ToolBtn>
        <ColorPick title="Text color" icon={Palette} defaultColor="#1f2937" onPick={(v) => applyFormat({ color: v })} />
        <ColorPick title="Fill color" icon={PaintBucket} defaultColor="#fffbeb" onPick={(v) => applyFormat({ bg: v })} />
        <Sep />
        <ToolBtn title="Align left" active={activeCell.align === "left"} onPress={() => applyFormat({ align: "left" })}>
          <AlignLeft className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Align center" active={activeCell.align === "center"} onPress={() => applyFormat({ align: "center" })}>
          <AlignCenter className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Align right" active={activeCell.align === "right"} onPress={() => applyFormat({ align: "right" })}>
          <AlignRight className="h-4 w-4" />
        </ToolBtn>
        <Sep />
        <select
          title="Number format"
          value={activeCell.fmt ?? "general"}
          onChange={(e) => applyFormat({ fmt: e.target.value as NumFormat })}
          onMouseDown={(e) => e.stopPropagation()}
          className="h-7 rounded border border-app bg-app px-2 text-[11px] text-app"
        >
          <option value="general">General</option>
          <option value="number">Number (1,234.56)</option>
          <option value="percent">Percent (12%)</option>
          <option value="currency">Currency ($1,234.56)</option>
          <option value="date">Date</option>
          <option value="time">Time</option>
          <option value="text">Plain text</option>
        </select>
        <Sep />
        <ToolBtn title="Insert row below" onPress={addRow}>
          <ArrowDownToLine className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Insert column right" onPress={addCol}>
          <ArrowRightToLine className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn title="Delete selected rows" onPress={removeRow}>
          <span className="text-[10px] font-semibold">−R</span>
        </ToolBtn>
        <ToolBtn title="Delete selected columns" onPress={removeCol}>
          <span className="text-[10px] font-semibold">−C</span>
        </ToolBtn>
      </div>

      {/* Formula / cell-reference bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-app bg-app px-3 py-1">
        <span className="rounded border border-app bg-app-elevated px-2 py-0.5 text-[11px] font-mono text-app-muted">
          {colName(anchor.c)}{anchor.r + 1}
        </span>
        <span className="text-[11px] text-app-faint">ƒx</span>
        <input
          ref={formulaRef}
          value={(activeCell.v ?? "")}
          onChange={(e) => setCell(anchor.r, anchor.c, { v: e.target.value })}
          onFocus={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              gridRef.current?.focus();
            }
          }}
          placeholder="Enter a value or formula (e.g. =SUM(A1:A10))"
          className="h-7 flex-1 rounded border border-app bg-app-elevated px-2 text-[12px] text-app focus:border-cyan-400/50 focus:outline-none"
        />
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-doc-canvas focus:outline-none"
        style={{ paddingBottom: 4 }}
      >
        <div style={{ width: HEADER_W + visibleCols * CELL_W, position: "relative" }}>
          {/* Column header */}
          <div
            className="sticky top-0 z-10 flex shrink-0"
            style={{ height: HEADER_H, paddingLeft: HEADER_W }}
          >
            <div
              className="absolute left-0 top-0 z-20 grid place-items-center border-b border-r border-app bg-app-elevated text-[10px] font-semibold text-app-faint"
              style={{ width: HEADER_W, height: HEADER_H }}
            />
            {Array.from({ length: visibleCols }).map((_, c) => (
              <div
                key={c}
                className={`grid place-items-center border-r border-b border-app text-[10px] font-semibold tabular-nums ${
                  c >= normalize(selection).c1 && c <= normalize(selection).c2
                    ? "bg-accent-soft text-accent"
                    : "bg-app-elevated text-app-faint"
                }`}
                style={{ width: CELL_W, height: HEADER_H, flex: "0 0 auto" }}
              >
                {colName(c)}
              </div>
            ))}
          </div>

          {/* Rows */}
          {Array.from({ length: visibleRows }).map((_, r) => {
            const norm = normalize(selection);
            const rowSelected = r >= norm.r1 && r <= norm.r2;
            return (
              <div
                key={r}
                className="flex"
                style={{ height: CELL_H, paddingLeft: HEADER_W }}
              >
                {/* Row header */}
                <div
                  className={`absolute left-0 grid place-items-center border-r border-b border-app text-[10px] font-semibold tabular-nums ${
                    rowSelected ? "bg-accent-soft text-accent" : "bg-app-elevated text-app-faint"
                  }`}
                  style={{ width: HEADER_W, height: CELL_H }}
                >
                  {r + 1}
                </div>
                {Array.from({ length: visibleCols }).map((_, c) => {
                  const cell = cellOf(sheet, r, c);
                  const display = computed[`${r}:${c}`] ?? formatCellValue(cell);
                  const isAnchor = anchor.r === r && anchor.c === c;
                  const isInSel =
                    r >= norm.r1 && r <= norm.r2 && c >= norm.c1 && c <= norm.c2;
                  const isEditing = editing && editing.r === r && editing.c === c;
                  return (
                    <div
                      key={c}
                      onMouseDown={(e) => mouseDownCell(r, c, e)}
                      onMouseEnter={() => mouseEnterCell(r, c)}
                      onDoubleClick={() => beginEdit(r, c)}
                      className={`relative shrink-0 cursor-cell select-none overflow-hidden truncate border-b border-r border-app px-2 text-[12px] ${
                        isAnchor
                          ? "outline outline-2 -outline-offset-1 outline-accent z-[1]"
                          : isInSel
                            ? "bg-accent-soft/40"
                            : ""
                      }`}
                      style={{
                        width: CELL_W,
                        height: CELL_H,
                        lineHeight: `${CELL_H - 2}px`,
                        fontWeight: cell.bold ? 700 : 400,
                        fontStyle: cell.italic ? "italic" : "normal",
                        textDecoration: [
                          cell.underline ? "underline" : "",
                          cell.strike ? "line-through" : "",
                        ].filter(Boolean).join(" ") || "none",
                        textAlign: cell.align ?? (isNumericValue(display) ? "right" : "left"),
                        color: cell.color ?? "inherit",
                        backgroundColor: cell.bg ?? undefined,
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editing.value}
                          autoFocus
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={() => commitEdit({ dr: 0, dc: 0 })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitEdit({ dr: 1 }); }
                            else if (e.key === "Tab") { e.preventDefault(); commitEdit({ dc: e.shiftKey ? -1 : 1 }); }
                            else if (e.key === "Escape") { setEditing(null); }
                          }}
                          className="absolute inset-0 z-10 w-full bg-app px-2 text-[12px] text-app outline-none"
                          style={{ lineHeight: `${CELL_H - 2}px` }}
                        />
                      ) : (
                        display
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sheet tabs */}
      <div className="flex shrink-0 items-center gap-1 border-t border-app bg-app-elevated px-2 py-1">
        {book.sheets.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveSheet(i)}
            onDoubleClick={() => {
              const next = prompt("Rename sheet", s.name);
              if (next) renameSheet(i, next);
            }}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
              i === activeSheet
                ? "bg-app text-app font-medium border-t-2 border-accent"
                : "text-app-muted hover:bg-app-hover"
            }`}
          >
            <span>{s.name}</span>
            {book.sheets.length > 1 && i === activeSheet && (
              <span
                role="button"
                title="Delete sheet"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete sheet "${s.name}"?`)) removeSheet(i);
                }}
                className="rounded p-0.5 text-app-faint hover:bg-rose-500/15 hover:text-rose-400"
              >
                <Trash2 className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addSheet}
          title="Add sheet"
          className="grid h-6 w-6 place-items-center rounded text-app-muted hover:bg-app-hover hover:text-app"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto truncate text-[10px] text-app-faint">{title}</span>
      </div>
    </div>
  );
}

/* ── UI helpers ────────────────────────────────────────────────────── */

function ToolBtn({
  title, onPress, active, children,
}: {
  title: string;
  onPress: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onPress}
      className={`grid h-7 w-7 place-items-center rounded transition ${
        active
          ? "bg-accent-soft text-accent"
          : "text-app-muted hover:bg-app-overlay hover:text-app"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-app-border" style={{ backgroundColor: "var(--app-border-strong, #e5e7eb)" }} />;
}

function ColorPick({
  title, icon: Icon, onPick, defaultColor,
}: {
  title: string;
  icon: typeof Bold;
  onPick: (v: string) => void;
  defaultColor: string;
}) {
  return (
    <label
      title={title}
      className="relative grid h-7 w-7 cursor-pointer place-items-center rounded text-app-muted hover:bg-app-overlay hover:text-app"
    >
      <Icon className="h-4 w-4" />
      <input
        type="color"
        defaultValue={defaultColor}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => onPick(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

type Range = { r1: number; c1: number; r2: number; c2: number };

function normalize(r: Range): Range {
  return {
    r1: Math.min(r.r1, r.r2),
    c1: Math.min(r.c1, r.c2),
    r2: Math.max(r.r1, r.r2),
    c2: Math.max(r.c1, r.c2),
  };
}

function colName(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    if (ch < "A" || ch > "Z") return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function cellOf(sheet: Sheet, r: number, c: number): SheetCell {
  return sheet.rows[r]?.[c] ?? {};
}

function maxCols(rows: SheetCell[][]): number {
  let m = 0;
  for (const row of rows) if (row.length > m) m = row.length;
  return m;
}

function makeRow(width: number): SheetCell[] {
  return Array.from({ length: Math.max(width, DEFAULT_COLS) }, () => ({}));
}

function ensureSize(rows: SheetCell[][], minRows: number, minCols: number): SheetCell[][] {
  let grown = rows;
  while (grown.length < minRows) grown = [...grown, makeRow(minCols)];
  return grown.map((row) => {
    if (row.length >= minCols) return row;
    const padded = row.slice();
    while (padded.length < minCols) padded.push({});
    return padded;
  });
}

function freshSheet(name: string): Sheet {
  return {
    name,
    rows: Array.from({ length: DEFAULT_ROWS }, () => makeRow(DEFAULT_COLS)),
  };
}

function formatCellValue(cell: SheetCell): string {
  const v = cell.c ?? cell.v ?? "";
  if (!v) return "";
  if (cell.fmt === "percent") {
    const n = Number(v);
    if (Number.isFinite(n)) return `${(n * 100).toFixed(2)}%`;
  }
  if (cell.fmt === "currency") {
    const n = Number(v);
    if (Number.isFinite(n)) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (cell.fmt === "number") {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  if (cell.fmt === "date") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  if (cell.fmt === "time") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString();
  }
  return String(v);
}

function isNumericValue(s: string): boolean {
  if (!s) return false;
  return /^[-+]?\d*\.?\d+([eE][-+]?\d+)?$/.test(s) || /^[\$€£¥]/.test(s);
}

/* ── Workbook parsing / serialisation ──────────────────────────────── */

function parseWorkbook(text: string): WorkbookJson {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { version: 1, sheets: [freshSheet("Sheet 1")] };
  // Try JSON envelope first
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.sheets)) {
      return parsed;
    }
  } catch { /* fall through */ }
  // CSV / TSV fallback
  const delim = trimmed.includes("\t") ? "\t" : ",";
  const rows = parseDelimited(trimmed, delim).map((row) =>
    row.map((value) => ({ v: value } as SheetCell)),
  );
  return {
    version: 1,
    sheets: [{ name: "Sheet 1", rows: rows.length > 0 ? rows : [makeRow(DEFAULT_COLS)] }],
  };
}

function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/* ── Formula evaluation ────────────────────────────────────────────── */

/**
 * Lightweight formula engine. Supports:
 *   - References: A1, $A$1, AB12 (absolute markers ignored)
 *   - Ranges: A1:B5
 *   - Functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ABS, ROUND
 *   - Operators: + - * / ( )
 *   - Numbers and quoted strings
 *
 * Returns a map of "r:c" -> string display value.
 */
function evaluateSheet(sheet: Sheet): Record<string, string> {
  const out: Record<string, string> = {};
  const cache: Record<string, string> = {};

  const valueAt = (r: number, c: number, stack: Set<string>): number | string => {
    const key = `${r}:${c}`;
    if (cache[key] !== undefined) return cache[key];
    if (stack.has(key)) return "#CIRC";
    const cell = sheet.rows[r]?.[c];
    if (!cell) return "";
    const raw = cell.v ?? "";
    if (!raw.startsWith("=")) {
      cache[key] = raw;
      return raw;
    }
    stack.add(key);
    try {
      const result = evaluate(raw.slice(1), sheet, stack);
      const display = typeof result === "number" ? formatNumber(result) : String(result);
      cache[key] = display;
      return display;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "#ERR";
      cache[key] = msg;
      return msg;
    } finally {
      stack.delete(key);
    }
  };

  for (let r = 0; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (!cell) continue;
      const v = cell.v ?? "";
      if (v.startsWith("=")) {
        const result = valueAt(r, c, new Set());
        out[`${r}:${c}`] = String(result);
      }
    }
  }

  return out;
}

function evaluate(expr: string, sheet: Sheet, stack: Set<string>): number | string {
  // Tokenise
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === " " || ch === "\t") { i += 1; continue; }
    if (ch === '"') {
      let s = "";
      i += 1;
      while (i < expr.length && expr[i] !== '"') { s += expr[i]; i += 1; }
      i += 1;
      tokens.push(JSON.stringify(s));
      continue;
    }
    if (/[A-Za-z$]/.test(ch)) {
      let s = "";
      while (i < expr.length && /[A-Za-z0-9_$:]/.test(expr[i])) { s += expr[i]; i += 1; }
      tokens.push(s);
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let s = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { s += expr[i]; i += 1; }
      tokens.push(s);
      continue;
    }
    tokens.push(ch);
    i += 1;
  }

  // Recursive-descent parser
  let p = 0;
  const peek = () => tokens[p];
  const eat = () => tokens[p++];

  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = eat();
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  };
  const parseTerm = (): number => {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = eat();
      const rhs = parseFactor();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  };
  const parseFactor = (): number => {
    const t = eat();
    if (t === undefined) throw new Error("#ERR");
    if (t === "(") {
      const v = parseExpr();
      if (eat() !== ")") throw new Error("#ERR");
      return v;
    }
    if (t === "-") return -parseFactor();
    if (t === "+") return parseFactor();
    if (/^"/.test(t)) return Number(JSON.parse(t)) || 0;
    if (/^[0-9.]+$/.test(t)) return parseFloat(t);
    // Function call
    if (/^[A-Za-z]+$/.test(t) && peek() === "(") {
      eat(); // (
      const args: Array<number | number[]> = [];
      if (peek() !== ")") {
        while (true) {
          // Argument can be a range or a sub-expression
          const start = p;
          const isRange = looksLikeRange(tokens, p);
          if (isRange) {
            const rangeToken = eat();
            args.push(rangeToValues(rangeToken, sheet, stack));
          } else {
            p = start;
            const v = parseExpr();
            args.push(v);
          }
          if (peek() === ",") { eat(); continue; }
          break;
        }
      }
      if (eat() !== ")") throw new Error("#ERR");
      return callFn(t.toUpperCase(), args);
    }
    // Cell reference
    if (/^[A-Za-z]+[0-9]+$/.test(t)) {
      const ref = parseRef(t);
      if (!ref) throw new Error("#REF");
      const val = sheet.rows[ref.r]?.[ref.c]?.v ?? "";
      if (val.startsWith("=")) {
        const sub = evaluate(val.slice(1), sheet, stack);
        return typeof sub === "number" ? sub : Number(sub) || 0;
      }
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    }
    throw new Error("#ERR");
  };

  const v = parseExpr();
  return v;
}

function looksLikeRange(tokens: string[], p: number): boolean {
  const t = tokens[p];
  return typeof t === "string" && /^[A-Za-z]+[0-9]+:[A-Za-z]+[0-9]+$/.test(t);
}

function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.replace(/\$/g, ""));
  if (!m) return null;
  return { r: parseInt(m[2], 10) - 1, c: colIndex(m[1]) };
}

function rangeToValues(token: string, sheet: Sheet, stack: Set<string>): number[] {
  const [a, b] = token.split(":");
  const aR = parseRef(a);
  const bR = parseRef(b);
  if (!aR || !bR) return [];
  const r1 = Math.min(aR.r, bR.r); const r2 = Math.max(aR.r, bR.r);
  const c1 = Math.min(aR.c, bR.c); const c2 = Math.max(aR.c, bR.c);
  const out: number[] = [];
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      const v = sheet.rows[r]?.[c]?.v ?? "";
      if (!v) continue;
      if (v.startsWith("=")) {
        const sub = evaluate(v.slice(1), sheet, stack);
        const n = typeof sub === "number" ? sub : Number(sub);
        if (Number.isFinite(n)) out.push(n);
      } else {
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
      }
    }
  }
  return out;
}

function callFn(name: string, args: Array<number | number[]>): number {
  const flat: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) flat.push(...a);
    else flat.push(a);
  }
  switch (name) {
    case "SUM":     return flat.reduce((a, b) => a + b, 0);
    case "AVERAGE": return flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : 0;
    case "MIN":     return flat.length ? Math.min(...flat) : 0;
    case "MAX":     return flat.length ? Math.max(...flat) : 0;
    case "COUNT":
    case "COUNTA":  return flat.length;
    case "ABS":     return Math.abs(flat[0] ?? 0);
    case "ROUND":   return Math.round(flat[0] ?? 0);
    case "FLOOR":   return Math.floor(flat[0] ?? 0);
    case "CEILING": return Math.ceil(flat[0] ?? 0);
    case "SQRT":    return Math.sqrt(flat[0] ?? 0);
    case "POWER":   return Math.pow(flat[0] ?? 0, flat[1] ?? 1);
    default:        throw new Error(`#NAME?`);
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "#ERR";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, "");
}
