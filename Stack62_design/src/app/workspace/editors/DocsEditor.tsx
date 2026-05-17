import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Outdent,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { appDialog } from "../../components/app-dialog";

/**
 * Google-Docs-style document editor. Built from scratch with three
 * principles that make formatting actually work:
 *
 * 1. The toolbar container catches mousedown and calls
 *    `preventDefault()` — this is the critical Docs/Gmail trick that
 *    prevents the editor from losing focus when you click a button.
 *    With focus retained, the user's selection survives the click and
 *    `execCommand` (or our manual fallback) has a real Range to work on.
 *
 * 2. CSS uses `.docs-editor` selectors with class-specific rules that
 *    override Tailwind preflight resets. Lists, headings, blockquote,
 *    code, tables, links — all explicitly styled so formatting is
 *    *visible* the moment it's applied.
 *
 * 3. `styleWithCSS=true` mode at init time so execCommand emits
 *    `style="font-weight:bold"` instead of the legacy `<b>` tags, which
 *    nest cleaner and survive selection re-wrapping.
 *
 * Coworker control: listens on `stack62:doc-command` for the AI to
 * drive the editor (get-content, replace-all, insert, exec, etc.).
 */

export type DocsLayout = {
  pageSize: "letter" | "a4" | "legal" | "tabloid" | "a5";
  orientation: "portrait" | "landscape";
  marginIn: number;
  fontFamily: string;
  fontSize: number;
};

const PAGE_SIZES: Record<DocsLayout["pageSize"], { name: string; widthIn: number; heightIn: number }> = {
  letter:  { name: "Letter",  widthIn: 8.5,  heightIn: 11 },
  a4:      { name: "A4",      widthIn: 8.27, heightIn: 11.69 },
  legal:   { name: "Legal",   widthIn: 8.5,  heightIn: 14 },
  tabloid: { name: "Tabloid", widthIn: 11,   heightIn: 17 },
  a5:      { name: "A5",      widthIn: 5.83, heightIn: 8.27 },
};

const FONT_FAMILIES: Array<{ value: string; label: string }> = [
  { value: "'Inter', 'Arial', sans-serif",                  label: "Inter" },
  { value: "Arial, Helvetica, sans-serif",                  label: "Arial" },
  { value: "'Roboto', 'Arial', sans-serif",                 label: "Roboto" },
  { value: "Georgia, 'Times New Roman', serif",             label: "Georgia" },
  { value: "'Times New Roman', Times, serif",               label: "Times New Roman" },
  { value: "'Courier New', Courier, monospace",             label: "Courier New" },
  { value: "ui-monospace, SFMono-Regular, Menlo, monospace", label: "Monospace" },
];

const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

const DEFAULT_LAYOUT: DocsLayout = {
  pageSize: "letter",
  orientation: "portrait",
  marginIn: 1,
  fontFamily: FONT_FAMILIES[0].value,
  fontSize: 14,
};

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

  /** Switch execCommand to CSS-style output once the editor mounts.
   *  Browsers default to producing legacy `<b>`/`<i>` tags; CSS-style
   *  produces `<span style="...">` which composes more cleanly. */
  useEffect(() => {
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch { /* ignore */ }
  }, []);

  /** Hydrate when text changes externally. We compare against the
   *  last value we emitted so user typing isn't clobbered. */
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (text === lastEmittedRef.current) return;
    el.innerHTML = looksLikeHtml(text) ? text : textToHtml(text);
    lastEmittedRef.current = el.innerHTML;
    setStats(computeStats(el));
  }, [text]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastEmittedRef.current = html;
    onChange(html);
    setStats(computeStats(el));
  }, [onChange]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const el = editorRef.current;
    if (!el || !el.contains(range.commonAncestorContainer)) return;
    savedRangeRef.current = range.cloneRange();
    updateActiveState();
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const range = savedRangeRef.current;
    if (range && el.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.focus();
      return;
    }
    // No saved range — place caret at end so commands have somewhere
    // to insert. This is what happens on the first toolbar click.
    el.focus();
    const sel = window.getSelection();
    const fresh = document.createRange();
    fresh.selectNodeContents(el);
    fresh.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(fresh);
  }, []);

  const updateActiveState = useCallback(() => {
    if (typeof document.queryCommandState !== "function") return;
    const next: Record<string, boolean> = {};
    const checks: Array<[string, string]> = [
      ["bold", "bold"],
      ["italic", "italic"],
      ["underline", "underline"],
      ["strikeThrough", "strike"],
      ["subscript", "sub"],
      ["superscript", "sup"],
      ["insertUnorderedList", "ul"],
      ["insertOrderedList", "ol"],
      ["justifyLeft", "left"],
      ["justifyCenter", "center"],
      ["justifyRight", "right"],
      ["justifyFull", "justify"],
    ];
    for (const [cmd, key] of checks) {
      try { next[key] = document.queryCommandState(cmd); } catch { /* ignore */ }
    }
    setActive(next);
    // Detect current block tag
    try {
      const blockTag = (document.queryCommandValue("formatBlock") || "p")
        .toString()
        .toLowerCase()
        .replace(/[<>]/g, "");
      setCurrentBlock(blockTag || "p");
    } catch { /* ignore */ }
  }, []);

  const exec = useCallback(
    (command: string, value?: string) => {
      restoreSelection();
      try {
        document.execCommand("styleWithCSS", false, "true");
        document.execCommand(command, false, value);
      } catch { /* ignore */ }
      saveSelection();
      emit();
    },
    [emit, restoreSelection, saveSelection],
  );

  const setBlock = useCallback(
    (tag: string) => exec("formatBlock", `<${tag}>`),
    [exec],
  );

  const insertHtml = useCallback(
    (html: string) => {
      restoreSelection();
      try {
        document.execCommand("insertHTML", false, html);
      } catch { /* ignore */ }
      saveSelection();
      emit();
    },
    [emit, restoreSelection, saveSelection],
  );

  // ── Coworker command bridge ───────────────────────────────────────
  // Lets the AI (or any caller) drive the editor through a window
  // event. Each command optionally includes a documentId — if it
  // doesn't match this editor, we ignore.
  useEffect(() => {
    const handler = (event: Event) => {
      const ev = event as CustomEvent<{
        documentId?: string | null;
        action: string;
        html?: string;
        text?: string;
        command?: string;
        value?: string;
        find?: string;
        replace?: string;
        requestId?: string;
      }>;
      const detail = ev.detail ?? ({} as Record<string, unknown>);
      if (detail.documentId && documentId && detail.documentId !== documentId) return;

      const reply = (payload: Record<string, unknown>) => {
        if (!detail.requestId) return;
        window.dispatchEvent(new CustomEvent("stack62:doc-command-reply", {
          detail: { requestId: detail.requestId, ...payload },
        }));
      };

      const el = editorRef.current;
      switch (detail.action) {
        case "get-content":
          reply({ documentId, html: el?.innerHTML ?? "", text: el?.innerText ?? "" });
          return;
        case "get-selection": {
          const sel = window.getSelection();
          reply({ documentId, text: sel ? sel.toString() : "" });
          return;
        }
        case "replace-all":
          if (el) {
            const next = looksLikeHtml(detail.html ?? "") ? (detail.html ?? "") : textToHtml(detail.text ?? detail.html ?? "");
            el.innerHTML = next;
            lastEmittedRef.current = next;
            onChange(next);
            setStats(computeStats(el));
          }
          reply({ ok: true });
          return;
        case "append":
          if (el) {
            const fragment = looksLikeHtml(detail.html ?? "") ? (detail.html ?? "") : textToHtml(detail.text ?? detail.html ?? "");
            el.insertAdjacentHTML("beforeend", fragment);
            const html = el.innerHTML;
            lastEmittedRef.current = html;
            onChange(html);
            setStats(computeStats(el));
          }
          reply({ ok: true });
          return;
        case "insert":
          insertHtml(looksLikeHtml(detail.html ?? "") ? (detail.html ?? "") : textToHtml(detail.text ?? detail.html ?? ""));
          reply({ ok: true });
          return;
        case "exec":
          if (detail.command) exec(detail.command, detail.value);
          reply({ ok: true });
          return;
        case "find-replace": {
          if (!el || !detail.find) { reply({ ok: false }); return; }
          const before = el.innerHTML;
          const escaped = detail.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const re = new RegExp(escaped, "g");
          const after = before.replace(re, detail.replace ?? "");
          if (after !== before) {
            el.innerHTML = after;
            lastEmittedRef.current = after;
            onChange(after);
            setStats(computeStats(el));
          }
          reply({ ok: true, replaced: (before.match(re) ?? []).length });
          return;
        }
        default:
          reply({ ok: false, error: "unknown action" });
      }
    };
    window.addEventListener("stack62:doc-command", handler);
    return () => window.removeEventListener("stack62:doc-command", handler);
  }, [documentId, emit, exec, insertHtml, onChange]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) { e.preventDefault(); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      b: () => exec("bold"),
      i: () => exec("italic"),
      u: () => exec("underline"),
      "1": () => setBlock("h1"),
      "2": () => setBlock("h2"),
      "3": () => setBlock("h3"),
      "0": () => setBlock("p"),
      "\\": () => exec("removeFormat"),
      z: () => (e.shiftKey ? exec("redo") : exec("undo")),
      y: () => exec("redo"),
      k: () => { void promptAndInsertLink(); },
    };
    const handler = map[k];
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  const promptAndInsertLink = async () => {
    const url = await appDialog.prompt({
      title: "Insert link",
      placeholder: "https://example.com",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      exec("createLink", url.trim());
    } else {
      insertHtml(`<a href="${escapeAttr(url.trim())}" target="_blank" rel="noreferrer">${escapeHtml(url.trim())}</a>`);
    }
  };

  const promptAndInsertImage = async () => {
    const url = await appDialog.prompt({
      title: "Insert image",
      placeholder: "https://example.com/image.png",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    insertHtml(`<img src="${escapeAttr(url.trim())}" alt="" />`);
  };

  const promptAndInsertTable = async () => {
    const rowsStr = await appDialog.prompt({
      title: "Insert table — rows",
      initialValue: "3", inputType: "number", confirmLabel: "Next",
    });
    if (!rowsStr) return;
    const colsStr = await appDialog.prompt({
      title: "Insert table — columns",
      initialValue: "3", inputType: "number", confirmLabel: "Insert",
    });
    if (!colsStr) return;
    const rows = Math.max(1, Math.min(20, Number(rowsStr) || 3));
    const cols = Math.max(1, Math.min(20, Number(colsStr) || 3));
    let html = '<table>';
    for (let r = 0; r < rows; r += 1) {
      html += '<tr>';
      for (let c = 0; c < cols; c += 1) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</table><p><br /></p>';
    insertHtml(html);
  };

  const scale = zoom / 100;
  const sizeIn = PAGE_SIZES[layout.pageSize];
  const isLandscape = layout.orientation === "landscape";
  const pxW = (isLandscape ? sizeIn.heightIn : sizeIn.widthIn) * 96 * scale;
  const padPx = layout.marginIn * 96 * scale;

  return (
    <div className="flex h-full flex-col bg-doc-canvas">
      {!readOnly && (
        <DocsToolbar
          layout={layout}
          setLayout={setLayout}
          active={active}
          currentBlock={currentBlock}
          onExec={exec}
          onBlock={setBlock}
          onLink={promptAndInsertLink}
          onImage={promptAndInsertImage}
          onTable={promptAndInsertTable}
          onPageBreak={() => insertHtml('<hr class="docs-pagebreak" /><p><br/></p>')}
          onHr={() => insertHtml('<hr />')}
          onTextColor={(c) => exec("foreColor", c)}
          onHighlight={(c) => exec("hiliteColor", c)}
          onFontFamily={(f) => exec("fontName", f)}
          onFontSize={(s) => { exec("fontSize", "7"); applyInlineFontSize(s); }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="py-8 px-4">
          <div
            className="mx-auto rounded-sm bg-doc-paper shadow-doc"
            style={{
              width: pxW,
              minHeight: pxW * 1.3,
              padding: padPx,
              fontFamily: layout.fontFamily,
              fontSize: layout.fontSize,
              color: "#111827",
            }}
          >
            <div
              ref={editorRef}
              contentEditable={!readOnly}
              suppressContentEditableWarning
              spellCheck
              data-doc-id={documentId ?? ""}
              onInput={() => { emit(); saveSelection(); }}
              onBlur={emit}
              onMouseUp={saveSelection}
              onKeyUp={saveSelection}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                if (readOnly) return;
                const txt = e.clipboardData.getData("text/plain");
                if (!txt) return;
                e.preventDefault();
                insertHtml(escapeHtml(txt).replace(/\r?\n/g, "<br/>"));
              }}
              className="docs-editor"
              style={{ lineHeight: 1.55, minHeight: "60vh", outline: "none" }}
            />
          </div>
        </div>
      </div>

      <DocsStatusBar stats={stats} title={title} />

      <style>{docsCss}</style>
    </div>
  );
}

/* ───────────── Toolbar ────────────────────────────────────────────── */

function DocsToolbar({
  layout,
  setLayout,
  active,
  currentBlock,
  onExec,
  onBlock,
  onLink,
  onImage,
  onTable,
  onPageBreak,
  onHr,
  onTextColor,
  onHighlight,
  onFontFamily,
  onFontSize,
}: {
  layout: DocsLayout;
  setLayout: (next: DocsLayout) => void;
  active: Record<string, boolean>;
  currentBlock: string;
  onExec: (cmd: string, value?: string) => void;
  onBlock: (tag: string) => void;
  onLink: () => void;
  onImage: () => void;
  onTable: () => void;
  onPageBreak: () => void;
  onHr: () => void;
  onTextColor: (c: string) => void;
  onHighlight: (c: string) => void;
  onFontFamily: (f: string) => void;
  onFontSize: (s: number) => void;
}) {
  return (
    // CRITICAL: onMouseDown preventDefault on the WHOLE toolbar
    // container — this is the trick that keeps the editor focused
    // and its selection alive. Without it, every click here would
    // blur the editor before the click handler runs.
    <div
      className="sticky top-0 z-20 shrink-0 border-b border-app bg-app-elevated text-app-muted shadow-sm"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-app-soft px-3 py-1.5 text-[11px]">
        <Select
          label="Page"
          value={layout.pageSize}
          options={Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.name }))}
          onPick={(v) => setLayout({ ...layout, pageSize: v as DocsLayout["pageSize"] })}
        />
        <Select
          label="Orientation"
          value={layout.orientation}
          options={[
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
          onPick={(v) => setLayout({ ...layout, orientation: v as DocsLayout["orientation"] })}
        />
        <Select
          label="Margins"
          value={String(layout.marginIn)}
          options={[
            { value: "0.5", label: "Narrow" },
            { value: "1", label: "Normal" },
            { value: "1.25", label: "Moderate" },
            { value: "1.5", label: "Wide" },
          ]}
          onPick={(v) => setLayout({ ...layout, marginIn: Number(v) || 1 })}
        />
        <Divider />
        <Select
          label="Font"
          value={layout.fontFamily}
          options={FONT_FAMILIES}
          onPick={(f) => { setLayout({ ...layout, fontFamily: f }); onFontFamily(f); }}
        />
        <Select
          label="Size"
          value={String(layout.fontSize)}
          options={FONT_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          onPick={(v) => {
            const n = Number(v) || 14;
            setLayout({ ...layout, fontSize: n });
            onFontSize(n);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5">
        <Select
          label="Style"
          value={normalizeBlock(currentBlock)}
          options={[
            { value: "p", label: "Normal text" },
            { value: "h1", label: "Heading 1" },
            { value: "h2", label: "Heading 2" },
            { value: "h3", label: "Heading 3" },
            { value: "blockquote", label: "Quote" },
            { value: "pre", label: "Code block" },
          ]}
          onPick={(t) => onBlock(t)}
        />
        <Divider />
        <Btn title="Heading 1" onPress={() => onBlock("h1")}><Heading1 className="h-4 w-4" /></Btn>
        <Btn title="Heading 2" onPress={() => onBlock("h2")}><Heading2 className="h-4 w-4" /></Btn>
        <Btn title="Heading 3" onPress={() => onBlock("h3")}><Heading3 className="h-4 w-4" /></Btn>
        <Btn title="Bold (Ctrl+B)" active={active.bold} onPress={() => onExec("bold")}><Bold className="h-4 w-4" /></Btn>
        <Btn title="Italic (Ctrl+I)" active={active.italic} onPress={() => onExec("italic")}><Italic className="h-4 w-4" /></Btn>
        <Btn title="Underline (Ctrl+U)" active={active.underline} onPress={() => onExec("underline")}><Underline className="h-4 w-4" /></Btn>
        <Btn title="Strikethrough" active={active.strike} onPress={() => onExec("strikeThrough")}><Strikethrough className="h-4 w-4" /></Btn>
        <Btn title="Subscript" active={active.sub} onPress={() => onExec("subscript")}><Subscript className="h-4 w-4" /></Btn>
        <Btn title="Superscript" active={active.sup} onPress={() => onExec("superscript")}><Superscript className="h-4 w-4" /></Btn>
        <ColorButton title="Text color" icon={Palette} onPick={onTextColor} defaultColor="#1f2937" />
        <ColorButton title="Highlight" icon={Highlighter} onPick={onHighlight} defaultColor="#fff59d" />
        <Divider />
        <Btn title="Bulleted list" active={active.ul} onPress={() => onExec("insertUnorderedList")}><List className="h-4 w-4" /></Btn>
        <Btn title="Numbered list" active={active.ol} onPress={() => onExec("insertOrderedList")}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn title="Quote" onPress={() => onBlock("blockquote")}><Quote className="h-4 w-4" /></Btn>
        <Btn title="Code block" onPress={() => onBlock("pre")}><Code className="h-4 w-4" /></Btn>
        <Btn title="Indent" onPress={() => onExec("indent")}><Indent className="h-4 w-4" /></Btn>
        <Btn title="Outdent" onPress={() => onExec("outdent")}><Outdent className="h-4 w-4" /></Btn>
        <Divider />
        <Btn title="Align left" active={active.left} onPress={() => onExec("justifyLeft")}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn title="Align center" active={active.center} onPress={() => onExec("justifyCenter")}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn title="Align right" active={active.right} onPress={() => onExec("justifyRight")}><AlignRight className="h-4 w-4" /></Btn>
        <Btn title="Justify" active={active.justify} onPress={() => onExec("justifyFull")}><AlignJustify className="h-4 w-4" /></Btn>
        <Divider />
        <Btn title="Insert link (Ctrl+K)" onPress={onLink}><Link2 className="h-4 w-4" /></Btn>
        <Btn title="Insert image" onPress={onImage}><ImageIcon className="h-4 w-4" /></Btn>
        <Btn title="Insert table" onPress={onTable}><Table2 className="h-4 w-4" /></Btn>
        <Btn title="Horizontal rule" onPress={onHr}><Minus className="h-4 w-4" /></Btn>
        <Btn title="Page break" onPress={onPageBreak}><span className="text-[10px] font-semibold">PB</span></Btn>
        <Divider />
        <Btn title="Undo (Ctrl+Z)" onPress={() => onExec("undo")}><Undo2 className="h-4 w-4" /></Btn>
        <Btn title="Redo (Ctrl+Y)" onPress={() => onExec("redo")}><Redo2 className="h-4 w-4" /></Btn>
        <Btn title="Clear formatting (Ctrl+\\)" onPress={() => onExec("removeFormat")}><Eraser className="h-4 w-4" /></Btn>
      </div>
    </div>
  );
}

function Btn({
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
      className={`grid h-8 w-8 place-items-center rounded transition ${
        active
          ? "bg-accent-soft text-accent"
          : "text-app-muted hover:bg-app-overlay hover:text-app"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-app-border" style={{ backgroundColor: "var(--app-border-strong, #e5e7eb)" }} />;
}

function Select({
  label, value, options, onPick,
}: {
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  return (
    <select
      title={label}
      value={value ?? ""}
      onChange={(e) => onPick(e.target.value)}
      // Selects need their own mousedown to not be eaten by the toolbar
      // wrapper's preventDefault (otherwise the dropdown won't open).
      onMouseDown={(e) => e.stopPropagation()}
      className="h-7 max-w-[160px] rounded border border-app bg-app-elevated px-2 text-[11px] text-app hover:border-app-strong focus:border-cyan-400/50 focus:outline-none"
    >
      {value === undefined && <option value="" disabled>{label}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ColorButton({
  title, icon: Icon, onPick, defaultColor,
}: {
  title: string;
  icon: LucideIcon;
  onPick: (value: string) => void;
  defaultColor: string;
}) {
  const id = useMemo(() => `cb-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <label
      htmlFor={id}
      title={title}
      className="relative grid h-8 w-8 cursor-pointer place-items-center rounded text-app-muted hover:bg-app-overlay hover:text-app"
    >
      <Icon className="h-4 w-4" />
      <input
        id={id}
        type="color"
        defaultValue={defaultColor}
        onChange={(e) => onPick(e.target.value)}
        // Re-enable native pointer events on the input itself so the
        // browser color picker opens — the toolbar wrapper's
        // preventDefault would otherwise swallow this click.
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

/* ───────────── Status bar ─────────────────────────────────────────── */

function DocsStatusBar({
  stats, title,
}: {
  stats: { words: number; chars: number };
  title?: string;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-app bg-app-elevated px-4 py-1 text-[11px] text-app-faint">
      <span className="truncate">{title ?? "Untitled"}</span>
      <span className="tabular-nums">
        {stats.words} word{stats.words === 1 ? "" : "s"} · {stats.chars} char{stats.chars === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ───────────── Helpers ────────────────────────────────────────────── */

function computeStats(el: HTMLElement): { words: number; chars: number } {
  const text = (el.innerText ?? "").trim();
  return {
    chars: text.length,
    words: text ? text.split(/\s+/).filter(Boolean).length : 0,
  };
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s ?? "");
}

function textToHtml(s: string): string {
  if (!s) return "";
  return s.split(/\r?\n\r?\n/).map((para) => {
    const inner = escapeHtml(para).replace(/\r?\n/g, "<br/>");
    return `<p>${inner || "<br/>"}</p>`;
  }).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function normalizeBlock(tag: string): string {
  const t = tag.toLowerCase();
  if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre", "div"].includes(t)) {
    return t === "div" ? "p" : t;
  }
  return "p";
}

/** execCommand("fontSize") only accepts values 1..7 (legacy HTML).
 *  After invoking it with a sentinel, we sweep the editor for the
 *  resulting <font size="7"> nodes and apply a real CSS font-size. */
function applyInlineFontSize(px: number): void {
  try {
    const fonts = document.querySelectorAll<HTMLElement>('font[size="7"]');
    fonts.forEach((f) => {
      f.removeAttribute("size");
      f.style.fontSize = `${px}px`;
    });
  } catch { /* ignore */ }
}

/* ───────────── Styles ─────────────────────────────────────────────── */

const docsCss = `
  /* Override Tailwind preflight so lists, headings, and blockquotes
     render properly inside the editor. Class-level specificity + !important
     to defeat any utility classes that would otherwise wipe the styling. */
  .docs-editor { font-family: inherit; }
  .docs-editor:focus { outline: none; }
  .docs-editor h1 { font-size: 1.85em !important; font-weight: 700 !important; margin: 18px 0 8px !important; line-height: 1.2 !important; color: inherit; }
  .docs-editor h2 { font-size: 1.45em !important; font-weight: 700 !important; margin: 16px 0 6px !important; line-height: 1.25 !important; color: inherit; }
  .docs-editor h3 { font-size: 1.20em !important; font-weight: 600 !important; margin: 14px 0 6px !important; line-height: 1.3 !important; color: inherit; }
  .docs-editor h4 { font-size: 1.10em !important; font-weight: 600 !important; margin: 12px 0 4px !important; }
  .docs-editor p  { margin: 6px 0 !important; }
  .docs-editor ul { list-style: disc !important; padding-left: 28px !important; margin: 8px 0 !important; }
  .docs-editor ol { list-style: decimal !important; padding-left: 28px !important; margin: 8px 0 !important; }
  .docs-editor ul ul { list-style: circle !important; }
  .docs-editor ul ul ul { list-style: square !important; }
  .docs-editor li { margin: 2px 0 !important; display: list-item !important; }
  .docs-editor blockquote {
    margin: 12px 0 !important; padding: 6px 14px !important;
    border-left: 4px solid #d1d5db !important;
    color: #4b5563 !important; background: #f9fafb !important;
    border-radius: 0 4px 4px 0 !important;
  }
  .docs-editor a { color: #2563eb !important; text-decoration: underline !important; }
  .docs-editor code {
    background: #f3f4f6 !important; padding: 1px 5px !important; border-radius: 3px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
    font-size: 0.92em !important; color: #be185d !important;
  }
  .docs-editor pre {
    background: #f3f4f6 !important; padding: 12px 14px !important; border-radius: 6px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
    font-size: 0.92em !important; overflow-x: auto !important; color: #1f2937 !important;
    margin: 8px 0 !important;
  }
  .docs-editor table { border-collapse: collapse !important; margin: 12px 0 !important; }
  .docs-editor table td, .docs-editor table th {
    border: 1px solid #d1d5db !important; padding: 6px 10px !important;
    min-width: 60px !important; vertical-align: top !important;
  }
  .docs-editor table th { background: #f9fafb !important; font-weight: 600 !important; }
  .docs-editor img { max-width: 100% !important; height: auto !important; border-radius: 2px; }
  .docs-editor hr {
    border: none !important; border-top: 1px solid #d1d5db !important;
    margin: 14px 0 !important; height: 0 !important;
  }
  .docs-editor hr.docs-pagebreak {
    border-top: 2px dashed #9ca3af !important;
    margin: 28px 0 !important;
    page-break-after: always; break-after: page;
  }
  .docs-editor strong, .docs-editor b { font-weight: 700 !important; }
  .docs-editor em, .docs-editor i { font-style: italic !important; }
  .docs-editor u { text-decoration: underline !important; }
  .docs-editor s, .docs-editor strike, .docs-editor del { text-decoration: line-through !important; }
  .docs-editor:empty::before {
    content: "Start typing — your changes save automatically.";
    color: #9ca3af; font-style: italic; pointer-events: none;
  }

  /* Paper canvas */
  .bg-doc-paper { background: #ffffff; color: #111827; }
  .bg-doc-canvas { background: #e5e7eb; }
  .shadow-doc { box-shadow: 0 6px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.05); }
  [data-app-theme='dark'] .bg-doc-paper { background: #1f2937; color: #f3f4f6; }
  [data-app-theme='dark'] .bg-doc-canvas { background: #0f172a; }
  [data-app-theme='dark'] .docs-editor blockquote { background: rgba(255,255,255,0.04) !important; color: #d1d5db !important; border-left-color: #4b5563 !important; }
  [data-app-theme='dark'] .docs-editor code { background: rgba(255,255,255,0.06) !important; color: #fda4af !important; }
  [data-app-theme='dark'] .docs-editor pre { background: rgba(255,255,255,0.06) !important; color: #f3f4f6 !important; }
  [data-app-theme='dark'] .docs-editor table th { background: rgba(255,255,255,0.04) !important; }
  [data-app-theme='dark'] .docs-editor table td, [data-app-theme='dark'] .docs-editor table th { border-color: rgba(255,255,255,0.12) !important; }
  [data-app-theme='dark'] .docs-editor hr { border-top-color: rgba(255,255,255,0.18) !important; }
`;
