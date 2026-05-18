import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { appDialog } from "../../components/app-dialog";

/**
 * Stack62 Docs — Google-Docs-style rich-text editor.
 *
 * Rewritten 2026-05 with the goal of being predictable rather than
 * comprehensive. Three rules drive the design:
 *
 *   1. **One source of truth.** The DOM inside the contentEditable
 *      element is the document. We render initial HTML once on mount
 *      and on external content changes; user typing never round-trips
 *      through React state. Reducing React's involvement in the hot
 *      path is what makes selection-based formatting actually work.
 *
 *   2. **Toolbar mousedown preventDefault.** This is the single trick
 *      that makes Docs/Word/Notion-style toolbars work. Clicking a
 *      formatting button would normally pull focus away from the
 *      editor, collapsing the selection. We catch mousedown at the
 *      toolbar root and call preventDefault, so the selection
 *      survives and execCommand has a real Range to apply to.
 *
 *   3. **execCommand + styleWithCSS.** Yes the API is "deprecated".
 *      No there is no production replacement that handles every edge
 *      case across Chrome/Safari/Firefox. styleWithCSS=true makes the
 *      browser emit `<span style="...">` instead of legacy `<b>`
 *      tags, which compose better when overlapping styles are applied.
 *
 * The Coworker drives this editor by dispatching `stack62:doc-command`
 * window events. See handleCommand() below for the verb list.
 */

const FONT_FAMILIES = [
  { value: "'Inter', 'Arial', sans-serif", label: "Inter" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
  { value: "ui-monospace, SFMono-Regular, Menlo, monospace", label: "Mono" },
];

const FONT_SIZES = [
  9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72,
];

const BLOCK_STYLES = [
  { value: "p", label: "Normal text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "blockquote", label: "Quote" },
  { value: "pre", label: "Code block" },
];

const PAGE_SIZES: Record<
  PageSize,
  { name: string; widthIn: number; heightIn: number }
> = {
  letter: { name: "Letter", widthIn: 8.5, heightIn: 11 },
  a4: { name: "A4", widthIn: 8.27, heightIn: 11.69 },
  legal: { name: "Legal", widthIn: 8.5, heightIn: 14 },
};

type PageSize = "letter" | "a4" | "legal";
type Orientation = "portrait" | "landscape";

interface DocsLayout {
  pageSize: PageSize;
  orientation: Orientation;
  marginIn: number;
  fontFamily: string;
  fontSize: number;
}

const DEFAULT_LAYOUT: DocsLayout = {
  pageSize: "letter",
  orientation: "portrait",
  marginIn: 1,
  fontFamily: FONT_FAMILIES[0].value,
  fontSize: 14,
};

interface DocCommandEvent {
  /** Optional document id to target. When omitted the active editor
   *  responds; this is useful when only one DocsEditor is mounted. */
  documentId?: string | null;
  /** Verb. See handleCommand for the supported set. */
  verb:
    | "get-content"
    | "get-text"
    | "replace-all"
    | "append"
    | "insert"
    | "exec"
    | "find-replace";
  /** Verb-specific payload. */
  payload?: Record<string, unknown>;
  /** Reply channel — the editor posts back here. */
  replyId?: string;
}

export function DocsEditor({
  text,
  onChange,
  zoom = 100,
  documentId,
  title,
  readOnly = false,
}: {
  text: string;
  onChange: (next: string) => void;
  zoom?: number;
  documentId?: string | null;
  title?: string;
  readOnly?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");
  const savedRangeRef = useRef<Range | null>(null);

  const [layout, setLayout] = useState<DocsLayout>(DEFAULT_LAYOUT);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [currentBlock, setCurrentBlock] = useState<string>("p");

  // ── Initial styleWithCSS setup ─────────────────────────────────
  useEffect(() => {
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Safari refuses some of these; the editor still works.
    }
  }, []);

  // ── Hydrate when external `text` changes ───────────────────────
  // We compare against the last value we emitted so the user's
  // typing doesn't get clobbered when the parent passes the same
  // string back after autosave.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (text === lastEmittedRef.current) return;
    el.innerHTML = looksLikeHtml(text) ? text : textToHtml(text);
    lastEmittedRef.current = el.innerHTML;
    setStats(computeStats(el));
  }, [text]);

  // ── Selection tracking — drives active-style indicators ─────────
  const refreshSelectionState = useCallback(() => {
    if (!editorRef.current) return;
    try {
      const next: Record<string, boolean> = {};
      for (const cmd of [
        "bold",
        "italic",
        "underline",
        "strikeThrough",
        "insertUnorderedList",
        "insertOrderedList",
        "justifyLeft",
        "justifyCenter",
        "justifyRight",
        "justifyFull",
      ]) {
        try {
          next[cmd] = document.queryCommandState(cmd);
        } catch {
          next[cmd] = false;
        }
      }
      setActive(next);

      // Detect current block element by walking up from the selection.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.getRangeAt(0).startContainer;
        while (node && node !== editorRef.current) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as Element).tagName.toLowerCase();
            if (
              tag === "h1" ||
              tag === "h2" ||
              tag === "h3" ||
              tag === "h4" ||
              tag === "blockquote" ||
              tag === "pre"
            ) {
              setCurrentBlock(tag);
              return;
            }
          }
          node = node.parentNode;
        }
        setCurrentBlock("p");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onSelectionChange = () => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
        refreshSelectionState();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [refreshSelectionState]);

  // ── Restore selection (used after toolbar interactions) ─────────
  const restoreSelection = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }, []);

  // ── Emit current content upward ────────────────────────────────
  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmittedRef.current = html;
    setStats(computeStats(el));
    onChange(html);
  }, [onChange]);

  // ── Toolbar primitives ─────────────────────────────────────────
  const exec = useCallback(
    (command: string, value?: string) => {
      const el = editorRef.current;
      if (!el || readOnly) return;
      restoreSelection();
      try {
        document.execCommand(command, false, value);
      } catch {
        /* ignore */
      }
      el.focus();
      refreshSelectionState();
      emit();
    },
    [emit, readOnly, refreshSelectionState, restoreSelection],
  );

  const setBlock = useCallback(
    (tag: string) => {
      if (tag === "p") exec("formatBlock", "<p>");
      else exec("formatBlock", `<${tag}>`);
    },
    [exec],
  );

  // ── Insert link ────────────────────────────────────────────────
  const insertLink = useCallback(async () => {
    const url = await appDialog.prompt({
      title: "Insert link",
      placeholder: "https://example.com",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    exec("createLink", url.startsWith("http") ? url : `https://${url}`);
  }, [exec]);

  // ── Insert image ───────────────────────────────────────────────
  const insertImage = useCallback(async () => {
    const url = await appDialog.prompt({
      title: "Insert image",
      placeholder: "https://example.com/image.png",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    exec("insertImage", url);
  }, [exec]);

  // ── Insert table ───────────────────────────────────────────────
  const insertTable = useCallback(async () => {
    const rowsStr = await appDialog.prompt({
      title: "Insert table",
      description: "Rows?",
      initialValue: "3",
      inputType: "number",
      confirmLabel: "Next",
    });
    if (!rowsStr) return;
    const colsStr = await appDialog.prompt({
      title: "Insert table",
      description: "Columns?",
      initialValue: "3",
      inputType: "number",
      confirmLabel: "Insert",
    });
    if (!colsStr) return;
    const rows = Math.max(1, Math.min(20, Number(rowsStr) || 3));
    const cols = Math.max(1, Math.min(20, Number(colsStr) || 3));
    let html = '<table class="s62-table"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += "</tbody></table><p></p>";
    exec("insertHTML", html);
  }, [exec]);

  // ── Coworker command bridge ────────────────────────────────────
  // The Coworker (or any feature) can dispatch `stack62:doc-command`
  // window events. Each verb returns synchronously via a reply event.
  const handleCommand = useCallback(
    (detail: DocCommandEvent) => {
      const el = editorRef.current;
      if (!el) return;
      if (detail.documentId && documentId && detail.documentId !== documentId)
        return;

      const reply = (output: unknown) => {
        if (!detail.replyId) return;
        window.dispatchEvent(
          new CustomEvent("stack62:doc-command-reply", {
            detail: { replyId: detail.replyId, output },
          }),
        );
      };

      switch (detail.verb) {
        case "get-content": {
          reply({ html: el.innerHTML, text: el.innerText });
          break;
        }
        case "get-text": {
          reply({ text: el.innerText });
          break;
        }
        case "replace-all": {
          const next = String(detail.payload?.html ?? detail.payload?.text ?? "");
          el.innerHTML = looksLikeHtml(next) ? next : textToHtml(next);
          emit();
          reply({ ok: true });
          break;
        }
        case "append": {
          const next = String(detail.payload?.html ?? detail.payload?.text ?? "");
          const block = document.createElement("div");
          block.innerHTML = looksLikeHtml(next) ? next : textToHtml(next);
          while (block.firstChild) el.appendChild(block.firstChild);
          emit();
          reply({ ok: true });
          break;
        }
        case "insert": {
          const html = String(detail.payload?.html ?? "");
          restoreSelection();
          try {
            document.execCommand("insertHTML", false, html);
          } catch {
            el.innerHTML = el.innerHTML + html;
          }
          emit();
          reply({ ok: true });
          break;
        }
        case "exec": {
          const command = String(detail.payload?.command ?? "");
          const value = detail.payload?.value as string | undefined;
          if (command) exec(command, value);
          reply({ ok: true });
          break;
        }
        case "find-replace": {
          const find = String(detail.payload?.find ?? "");
          const replace = String(detail.payload?.replace ?? "");
          if (!find) {
            reply({ ok: false, error: "find is required" });
            break;
          }
          const re = new RegExp(escapeRegex(find), "g");
          const before = el.innerHTML;
          el.innerHTML = before.replace(re, escapeHtml(replace));
          emit();
          reply({ ok: true, replacements: (before.match(re) ?? []).length });
          break;
        }
      }
    },
    [documentId, emit, exec, restoreSelection],
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const ev = event as CustomEvent<DocCommandEvent>;
      if (!ev.detail) return;
      handleCommand(ev.detail);
    };
    window.addEventListener("stack62:doc-command", listener);
    return () =>
      window.removeEventListener("stack62:doc-command", listener);
  }, [handleCommand]);

  // ── Page geometry ──────────────────────────────────────────────
  const pageStyle = useMemo(() => {
    const size = PAGE_SIZES[layout.pageSize];
    const portrait = layout.orientation === "portrait";
    const widthIn = portrait ? size.widthIn : size.heightIn;
    const heightIn = portrait ? size.heightIn : size.widthIn;
    return {
      width: `${widthIn}in`,
      minHeight: `${heightIn}in`,
      padding: `${layout.marginIn}in`,
      fontFamily: layout.fontFamily,
      fontSize: `${layout.fontSize}px`,
    } as const;
  }, [layout]);

  // ── Keyboard shortcuts inside the editor ───────────────────────
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const cmd = e.ctrlKey || e.metaKey;
    if (!cmd) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      exec("bold");
    } else if (k === "i") {
      e.preventDefault();
      exec("italic");
    } else if (k === "u") {
      e.preventDefault();
      exec("underline");
    } else if (k === "k") {
      e.preventDefault();
      void insertLink();
    } else if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      exec("undo");
    } else if ((k === "z" && e.shiftKey) || k === "y") {
      e.preventDefault();
      exec("redo");
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#f1f3f4] text-[#1f1f1f]">
      {/* Title strip */}
      {title && (
        <div className="border-b border-app bg-app-surface px-4 py-1.5 text-xs text-app-muted">
          {title}
        </div>
      )}

      {/* Toolbar — see "Toolbar mousedown preventDefault" note above */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-app bg-app-surface px-2 py-1 text-[12px] text-app"
        onMouseDown={(e) => {
          // Anything other than an input loses focus = collapsed
          // selection. Intercept here so toolbar clicks don't fight
          // the contentEditable.
          if (
            e.target instanceof HTMLElement &&
            !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)
          ) {
            e.preventDefault();
          }
        }}
      >
        <ToolbarButton icon={Undo2} label="Undo (⌘Z)" onClick={() => exec("undo")} />
        <ToolbarButton icon={Redo2} label="Redo (⌘⇧Z)" onClick={() => exec("redo")} />
        <Divider />

        <select
          value={currentBlock}
          onChange={(e) => setBlock(e.target.value)}
          className="h-7 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
          title="Paragraph style"
        >
          {BLOCK_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={layout.fontFamily}
          onChange={(e) => {
            setLayout((cur) => ({ ...cur, fontFamily: e.target.value }));
            exec("fontName", e.target.value);
          }}
          className="ml-1 h-7 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
          title="Font"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={layout.fontSize}
          onChange={(e) => {
            const size = Number(e.target.value);
            setLayout((cur) => ({ ...cur, fontSize: size }));
            // execCommand fontSize is 1..7. We use a custom span instead.
            wrapSelection(`font-size:${size}px`);
            emit();
          }}
          className="ml-1 h-7 w-14 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
          title="Font size"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <Divider />

        <ToolbarButton
          icon={Bold}
          label="Bold (⌘B)"
          active={active.bold}
          onClick={() => exec("bold")}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic (⌘I)"
          active={active.italic}
          onClick={() => exec("italic")}
        />
        <ToolbarButton
          icon={Underline}
          label="Underline (⌘U)"
          active={active.underline}
          onClick={() => exec("underline")}
        />
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          active={active.strikeThrough}
          onClick={() => exec("strikeThrough")}
        />

        <ColorPicker
          icon={Palette}
          label="Text color"
          onPick={(color) => exec("foreColor", color)}
        />
        <ColorPicker
          icon={Highlighter}
          label="Highlight"
          onPick={(color) => exec("hiliteColor", color)}
        />

        <Divider />

        <ToolbarButton
          icon={AlignLeft}
          label="Align left"
          active={active.justifyLeft}
          onClick={() => exec("justifyLeft")}
        />
        <ToolbarButton
          icon={AlignCenter}
          label="Align center"
          active={active.justifyCenter}
          onClick={() => exec("justifyCenter")}
        />
        <ToolbarButton
          icon={AlignRight}
          label="Align right"
          active={active.justifyRight}
          onClick={() => exec("justifyRight")}
        />
        <ToolbarButton
          icon={AlignJustify}
          label="Justify"
          active={active.justifyFull}
          onClick={() => exec("justifyFull")}
        />

        <Divider />

        <ToolbarButton
          icon={List}
          label="Bulleted list"
          active={active.insertUnorderedList}
          onClick={() => exec("insertUnorderedList")}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          active={active.insertOrderedList}
          onClick={() => exec("insertOrderedList")}
        />
        <ToolbarButton
          icon={Quote}
          label="Quote"
          onClick={() => setBlock("blockquote")}
        />

        <Divider />

        <ToolbarButton
          icon={Link2}
          label="Insert link (⌘K)"
          onClick={() => void insertLink()}
        />
        <ToolbarButton
          icon={ImageIcon}
          label="Insert image"
          onClick={() => void insertImage()}
        />
        <ToolbarButton
          icon={TableIcon}
          label="Insert table"
          onClick={() => void insertTable()}
        />
        <ToolbarButton
          icon={Minus}
          label="Horizontal rule"
          onClick={() => exec("insertHorizontalRule")}
        />

        <Divider />

        <ToolbarButton
          icon={Eraser}
          label="Clear formatting"
          onClick={() => exec("removeFormat")}
        />

        <div className="ml-auto flex items-center gap-2 pr-1">
          <select
            value={layout.pageSize}
            onChange={(e) =>
              setLayout((cur) => ({
                ...cur,
                pageSize: e.target.value as PageSize,
              }))
            }
            className="h-7 rounded border border-app bg-app px-1 text-[11px]"
            title="Page size"
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
            <option value="legal">Legal</option>
          </select>
          <span className="text-[10px] text-app-faint">
            {stats.words} words · {stats.chars} chars
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="min-h-0 flex-1 overflow-auto py-6">
        <div
          className="mx-auto bg-white text-[#1f1f1f] shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
          style={{
            ...pageStyle,
            transform: `scale(${Math.max(0.5, zoom / 100)})`,
            transformOrigin: "top center",
          }}
        >
          <div
            ref={editorRef}
            contentEditable={!readOnly}
            suppressContentEditableWarning
            spellCheck
            onInput={emit}
            onKeyDown={onKeyDown}
            onBlur={emit}
            className="docs-editor outline-none"
            style={{
              minHeight: "100%",
              fontFamily: layout.fontFamily,
              fontSize: `${layout.fontSize}px`,
              lineHeight: 1.6,
            }}
          />
        </div>
      </div>

      <style>{`
        .docs-editor h1 { font-size: 2em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .docs-editor h2 { font-size: 1.5em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .docs-editor h3 { font-size: 1.25em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .docs-editor h4 { font-size: 1.1em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .docs-editor p { margin: 0.4em 0; }
        .docs-editor ul, .docs-editor ol { padding-left: 1.6em; margin: 0.4em 0; }
        .docs-editor li { margin: 0.15em 0; }
        .docs-editor blockquote {
          border-left: 3px solid #c4c7c5;
          padding: 0.2em 0.8em;
          margin: 0.6em 0;
          color: #5f6368;
        }
        .docs-editor pre {
          background: #f1f3f4;
          padding: 0.8em;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.9em;
          margin: 0.6em 0;
          overflow-x: auto;
        }
        .docs-editor a { color: #1a73e8; text-decoration: underline; }
        .docs-editor img { max-width: 100%; height: auto; }
        .docs-editor table.s62-table {
          border-collapse: collapse;
          margin: 0.6em 0;
          min-width: 50%;
        }
        .docs-editor table.s62-table td {
          border: 1px solid #d0d4d8;
          padding: 0.4em 0.6em;
          min-width: 50px;
          vertical-align: top;
        }
        .docs-editor hr {
          border: none;
          border-top: 1px solid #d0d4d8;
          margin: 1em 0;
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function ToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded transition ${
        active
          ? "bg-accent-soft text-accent"
          : "text-app-muted hover:bg-app-hover"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-app" />;
}

function ColorPicker({
  icon: Icon,
  label,
  onPick,
}: {
  icon: LucideIcon;
  label: string;
  onPick: (color: string) => void;
}) {
  const COLORS = [
    "#1f1f1f",
    "#5f6368",
    "#ea4335",
    "#fbbc04",
    "#34a853",
    "#1a73e8",
    "#a142f4",
    "#ffffff",
    "#fef7e0",
    "#e8f5e8",
    "#e8f0fe",
    "#fce8e6",
  ];
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <ToolbarButton icon={Icon} label={label} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 grid w-32 grid-cols-6 gap-0.5 rounded border border-app bg-app-elevated p-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className="h-5 w-5 rounded border border-app"
              style={{ backgroundColor: c }}
              aria-label={c}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Wrap the current selection with a span carrying the given style.
 *  Used for font-size because execCommand's fontSize takes a 1..7
 *  legacy scale, which we don't want to map. */
function wrapSelection(style: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const span = document.createElement("span");
  span.setAttribute("style", style);
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    // Reselect the inserted content so further edits target it.
    const next = document.createRange();
    next.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(next);
  } catch {
    /* ignore */
  }
}

function computeStats(el: HTMLElement): { words: number; chars: number } {
  const text = el.innerText ?? "";
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { words, chars: text.length };
}

function looksLikeHtml(s: string): boolean {
  if (!s) return false;
  return /<\/?(p|div|span|h[1-6]|ul|ol|li|table|tr|td|a|br|hr|strong|em|b|i)\b/i.test(
    s,
  );
}

function textToHtml(s: string): string {
  if (!s) return "<p></p>";
  return s
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p>${para
          .split(/\n/)
          .map((line) => escapeHtml(line))
          .join("<br>")}</p>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
