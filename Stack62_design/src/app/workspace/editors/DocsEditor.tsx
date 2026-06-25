import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
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
  Rows3,
  Palette,
  Quote,
  Redo2,
  Settings2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { appDialog } from "../../components/app-dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import UnderlineExt from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import ImageExt from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Pagination, repaginate, type PageGeometry } from "./docs-pagination";

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
  { value: "paragraph", label: "Normal text" },
  { value: "heading 1", label: "Heading 1" },
  { value: "heading 2", label: "Heading 2" },
  { value: "heading 3", label: "Heading 3" },
  { value: "heading 4", label: "Heading 4" },
  { value: "blockquote", label: "Quote" },
  { value: "codeBlock", label: "Code block" },
];

const PAGE_SIZES: Record<
  PageSize,
  { name: string; widthIn: number; heightIn: number }
> = {
  letter: { name: "Letter (8.5 × 11\")", widthIn: 8.5, heightIn: 11 },
  a4: { name: "A4 (8.27 × 11.69\")", widthIn: 8.27, heightIn: 11.69 },
  legal: { name: "Legal (8.5 × 14\")", widthIn: 8.5, heightIn: 14 },
  a5: { name: "A5 (5.83 × 8.27\")", widthIn: 5.83, heightIn: 8.27 },
  tabloid: { name: "Tabloid (11 × 17\")", widthIn: 11, heightIn: 17 },
};

const MARGIN_PRESETS: { value: number; label: string }[] = [
  { value: 1, label: "Normal (1\")" },
  { value: 0.5, label: "Narrow (0.5\")" },
  { value: 0.75, label: "Moderate (0.75\")" },
  { value: 1.5, label: "Wide (1.5\")" },
  { value: 0, label: "None" },
];

type PageSize = "letter" | "a4" | "legal" | "a5" | "tabloid";
type Orientation = "portrait" | "landscape";

interface DocsLayout {
  pageSize: PageSize;
  orientation: Orientation;
  marginIn: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number; // em, applied above/below each block
  headerText: string;
  footerText: string;
}

const DEFAULT_LAYOUT: DocsLayout = {
  pageSize: "letter",
  orientation: "portrait",
  marginIn: 1,
  fontFamily: FONT_FAMILIES[0].value,
  fontSize: 14,
  lineHeight: 1.5,
  paragraphSpacing: 0.4,
  headerText: "",
  footerText: "",
};

const LINE_SPACINGS: { value: number; label: string }[] = [
  { value: 1, label: "Single" },
  { value: 1.15, label: "1.15" },
  { value: 1.5, label: "1.5" },
  { value: 2, label: "Double" },
  { value: 2.5, label: "2.5" },
  { value: 3, label: "Triple" },
];

const PARAGRAPH_SPACINGS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 0.25, label: "Tight" },
  { value: 0.4, label: "Normal" },
  { value: 0.7, label: "Relaxed" },
  { value: 1, label: "Loose" },
];

interface DocCommandEvent {
  documentId?: string | null;
  verb:
    | "get-content"
    | "get-text"
    | "replace-all"
    | "append"
    | "insert"
    | "exec"
    | "find-replace";
  payload?: Record<string, unknown>;
  replyId?: string;
}

function looksLikeHtml(s: string): boolean {
  if (!s) return false;
  return /<\/?(p|div|span|h[1-6]|ul|ol|li|table|tr|td|a|br|hr|strong|em|b|i)\b/i.test(s);
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
  const lastEmittedRef = useRef<string>("");
  const [layout, setLayout] = useState<DocsLayout>(DEFAULT_LAYOUT);
  const [docPageCount, setDocPageCount] = useState(1);
  // The pagination plugin is created once with the editor, so it reads the
  // live geometry through this ref rather than a stale closure.
  const geometryRef = useRef<PageGeometry>({ contentHeight: 0, breakHeight: 0 });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: true,
        codeBlock: true,
        code: true,
        bulletList: true,
        orderedList: true,
        horizontalRule: true,
        dropcursor: { color: "#1a73e8" },
        gapcursor: true,
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Type something..." }),
      UnderlineExt,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      // Preserve images (incl. base64 from .docx import) and tables.
      ImageExt.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: { class: "docs-image" },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: { class: "s62-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      Pagination.configure({
        getGeometry: () => geometryRef.current,
        onPageCount: (pages) => setDocPageCount(pages),
      }),
    ],
    content: looksLikeHtml(text) ? text : textToHtml(text),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      if (html !== lastEmittedRef.current) {
        lastEmittedRef.current = html;
        onChange(html);
      }
    },
    editorProps: {
      attributes: {
        // Typography is driven reactively from the EditorContent wrapper below
        // (inherited) so toolbar changes take effect; keep this element clean.
        class: "docs-editor outline-none",
        style: "min-height: 100%;",
      },
    },
  });

  // Update editor when external text changes
  useEffect(() => {
    if (!editor) return;
    if (text === lastEmittedRef.current) return;
    const content = looksLikeHtml(text) ? text : textToHtml(text);
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [text, editor]);

  // Command handler for AI coworker
  const handleCommand = useCallback(
    (detail: DocCommandEvent) => {
      if (!editor) return;
      if (detail.documentId && documentId && detail.documentId !== documentId) return;

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
          reply({ html: editor.getHTML(), text: editor.getText() });
          break;
        }
        case "get-text": {
          reply({ text: editor.getText() });
          break;
        }
        case "replace-all": {
          const next = String(detail.payload?.html ?? detail.payload?.text ?? "");
          editor.commands.setContent(looksLikeHtml(next) ? next : textToHtml(next));
          reply({ ok: true });
          break;
        }
        case "append": {
          const next = String(detail.payload?.html ?? detail.payload?.text ?? "");
          editor.commands.insertContentAt(
            editor.state.doc.content.size,
            looksLikeHtml(next) ? next : textToHtml(next)
          );
          reply({ ok: true });
          break;
        }
        case "insert": {
          const html = String(detail.payload?.html ?? "");
          editor.commands.insertContent(html);
          reply({ ok: true });
          break;
        }
        case "exec": {
          const command = String(detail.payload?.command ?? "");
          const value = detail.payload?.value as string | undefined;
          if (command) {
            switch (command) {
              case "bold": editor.commands.toggleBold(); break;
              case "italic": editor.commands.toggleItalic(); break;
              case "underline": editor.commands.toggleUnderline(); break;
              case "strikeThrough": editor.commands.toggleStrike(); break;
              case "insertUnorderedList": editor.commands.toggleBulletList(); break;
              case "insertOrderedList": editor.commands.toggleOrderedList(); break;
              case "justifyLeft": editor.commands.setTextAlign("left"); break;
              case "justifyCenter": editor.commands.setTextAlign("center"); break;
              case "justifyRight": editor.commands.setTextAlign("right"); break;
              case "justifyFull": editor.commands.setTextAlign("justify"); break;
              case "insertHorizontalRule": editor.commands.setHorizontalRule(); break;
              case "removeFormat": editor.commands.unsetAllMarks(); break;
              case "undo": editor.commands.undo(); break;
              case "redo": editor.commands.redo(); break;
              default:
                if (value) editor.commands.command({ fn: () => true });
            }
          }
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
          const { doc } = editor.state;
          let count = 0;
          let html = editor.getHTML();
          const re = new RegExp(escapeRegex(find), "g");
          html = html.replace(re, () => { count++; return replace; });
          editor.commands.setContent(html);
          reply({ ok: true, replacements: count });
          break;
        }
      }
    },
    [editor, documentId],
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const ev = event as CustomEvent<DocCommandEvent>;
      if (!ev.detail) return;
      handleCommand(ev.detail);
    };
    window.addEventListener("stack62:doc-command", listener);
    return () => window.removeEventListener("stack62:doc-command", listener);
  }, [handleCommand]);

  // Feed the live page geometry to the pagination plugin and re-paginate
  // whenever something that affects block heights or page bounds changes
  // (page size, orientation, margins, or font). The plugin itself handles
  // re-paginating on document edits.
  useEffect(() => {
    if (!editor) return;
    const size = PAGE_SIZES[layout.pageSize];
    const portrait = layout.orientation === "portrait";
    const pageHPx = Math.round((portrait ? size.heightIn : size.widthIn) * 96);
    const marginPx = Math.round(layout.marginIn * 96);
    const gap = 24;
    geometryRef.current = {
      contentHeight: Math.max(1, pageHPx - 2 * marginPx),
      breakHeight: 2 * marginPx + gap,
    };
    repaginate(editor.view);
  }, [
    editor,
    layout.pageSize,
    layout.orientation,
    layout.marginIn,
    layout.fontFamily,
    layout.fontSize,
    layout.lineHeight,
    layout.paragraphSpacing,
  ]);

  // Async content (web fonts, images) reflows the document *after* the first
  // pagination pass, so we re-paginate once each of those settles. We do NOT
  // use a ResizeObserver here: our own page-spacers change the editor height,
  // which would retrigger the observer and make the layout shake. These are
  // discrete one-shot triggers instead, so the page stays steady.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const dom = editor.view.dom as HTMLElement;

    const kick = () => {
      if (!cancelled) repaginate(editor.view);
    };

    // Fonts: text metrics change when the real font swaps in.
    document.fonts?.ready.then(kick);

    // Images: each one's height is unknown until it loads. Re-paginate as they
    // arrive (a handful of discrete events, not a continuous loop).
    const imgs = Array.from(dom.querySelectorAll("img"));
    const pending = imgs.filter((img) => !img.complete);
    const onImg = () => {
      window.requestAnimationFrame(kick);
    };
    pending.forEach((img) => {
      img.addEventListener("load", onImg, { once: true });
      img.addEventListener("error", onImg, { once: true });
    });

    return () => {
      cancelled = true;
      pending.forEach((img) => {
        img.removeEventListener("load", onImg);
        img.removeEventListener("error", onImg);
      });
    };
  }, [editor, text]);

  // Page dimensions computed for rendering
  const pageDims = useMemo(() => {
    const size = PAGE_SIZES[layout.pageSize];
    const portrait = layout.orientation === "portrait";
    const wPx = Math.round((portrait ? size.widthIn : size.heightIn) * 96);
    const hPx = Math.round((portrait ? size.heightIn : size.widthIn) * 96);
    const marginPx = Math.round(layout.marginIn * 96);
    const gap = 24;
    return { wPx, hPx, marginPx, gap };
  }, [layout.pageSize, layout.orientation, layout.marginIn]);

  const insertLink = useCallback(async () => {
    if (!editor) return;
    const url = await appDialog.prompt({
      title: "Insert link",
      placeholder: "https://example.com",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    editor.commands.setLink({ href: url.startsWith("http") ? url : `https://${url}` });
  }, [editor]);

  const insertImage = useCallback(async () => {
    if (!editor) return;
    const url = await appDialog.prompt({
      title: "Insert image",
      placeholder: "https://example.com/image.png",
      inputType: "url",
      confirmLabel: "Insert",
    });
    if (!url) return;
    editor.chain().focus().setImage({ src: url, alt: "Image" }).run();
  }, [editor]);

  const insertTable = useCallback(async () => {
    if (!editor) return;
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
    editor
      .chain()
      .focus()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
  }, [editor]);

  const stats = useMemo(() => {
    if (!editor) return { words: 0, chars: 0 };
    const text = editor.getText();
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, chars: text.length };
  }, [editor, editor?.state]);

  if (!editor) return null;

  return (
    <div className="flex h-full flex-col bg-[#f1f3f4] text-[#1f1f1f]">
      {title && (
        <div className="border-b border-app bg-app-surface px-4 py-1.5 text-xs text-app-muted">
          {title}
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-app bg-app-surface px-2 py-1 text-[12px] text-app"
        onMouseDown={(e) => e.preventDefault()}
      >
        <ToolbarButton icon={Undo2} label="Undo (⌘Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
        <ToolbarButton icon={Redo2} label="Redo (⌘⇧Z)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
        <Divider />

        <select
          value={
            editor.isActive("heading", { level: 1 }) ? "heading 1" :
            editor.isActive("heading", { level: 2 }) ? "heading 2" :
            editor.isActive("heading", { level: 3 }) ? "heading 3" :
            editor.isActive("heading", { level: 4 }) ? "heading 4" :
            editor.isActive("blockquote") ? "blockquote" :
            editor.isActive("codeBlock") ? "codeBlock" : "paragraph"
          }
          onChange={(e) => {
            editor.chain().focus();
            switch (e.target.value) {
              case "paragraph": editor.commands.setParagraph(); break;
              case "heading 1": editor.commands.toggleHeading({ level: 1 }); break;
              case "heading 2": editor.commands.toggleHeading({ level: 2 }); break;
              case "heading 3": editor.commands.toggleHeading({ level: 3 }); break;
              case "heading 4": editor.commands.toggleHeading({ level: 4 }); break;
              case "blockquote": editor.commands.toggleBlockquote(); break;
              case "codeBlock": editor.commands.toggleCodeBlock(); break;
            }
          }}
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
          onChange={(e) => setLayout((cur) => ({ ...cur, fontSize: Number(e.target.value) }))}
          className="ml-1 h-7 w-14 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
          title="Font size"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <span
          className="ml-1 inline-flex items-center"
          title="Line spacing"
        >
          <Rows3 className="mr-0.5 h-3.5 w-3.5 text-app-muted" />
          <select
            value={layout.lineHeight}
            onChange={(e) =>
              setLayout((cur) => ({ ...cur, lineHeight: Number(e.target.value) }))
            }
            className="h-7 w-16 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
            aria-label="Line spacing"
          >
            {LINE_SPACINGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </span>

        <Divider />

        <ToolbarButton
          icon={Bold}
          label="Bold (⌘B)"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={Italic}
          label="Italic (⌘I)"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={Underline}
          label="Underline (⌘U)"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          icon={Strikethrough}
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />

        <ColorPicker
          icon={Palette}
          label="Text color"
          onPick={(color) => editor.chain().focus().setColor(color).run()}
        />
        <ColorPicker
          icon={Highlighter}
          label="Highlight"
          onPick={(color) => editor.chain().focus().setHighlight({ color }).run()}
        />

        <Divider />

        <ToolbarButton
          icon={AlignLeft}
          label="Align left"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <ToolbarButton
          icon={AlignCenter}
          label="Align center"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolbarButton
          icon={AlignRight}
          label="Align right"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <ToolbarButton
          icon={AlignJustify}
          label="Justify"
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        />

        <Divider />

        <ToolbarButton
          icon={List}
          label="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrdered}
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={Quote}
          label="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
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
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />

        <Divider />

        <ToolbarButton
          icon={Eraser}
          label="Clear formatting"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        />

        <div className="ml-auto flex items-center gap-2 pr-1">
          <PageSetup layout={layout} setLayout={setLayout} />
          <span className="text-[10px] text-app-faint">
            {stats.words} words · {stats.chars} chars
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[#e8eaed] py-6">
        <div
          style={{
            transform: `scale(${Math.max(0.5, zoom / 100)})`,
            transformOrigin: "top center",
          }}
        >
          {/* Multi-page canvas: separate white page sheets + single editor overlay */}
          <div
            className="relative mx-auto"
            style={{
              width: pageDims.wPx,
              minHeight: docPageCount * pageDims.hPx + (docPageCount - 1) * pageDims.gap,
            }}
          >
            {/* Page background sheets, each with its own header / footer
                rendered inside the top / bottom margins. */}
            {Array.from({ length: docPageCount }).map((_, i) => (
              <div
                key={i}
                style={{
                  position:      "absolute",
                  top:           i * (pageDims.hPx + pageDims.gap),
                  left:          0,
                  right:         0,
                  height:        pageDims.hPx,
                  background:    "white",
                  boxShadow:     "0 1px 3px rgba(60,64,67,0.15), 0 2px 6px rgba(60,64,67,0.1)",
                  pointerEvents: "none",
                  zIndex:        0,
                }}
              >
                {layout.headerText.trim() && (
                  <div
                    className="docs-running-head"
                    style={{
                      position: "absolute",
                      top: Math.max(8, pageDims.marginPx * 0.4),
                      left: pageDims.marginPx,
                      right: pageDims.marginPx,
                    }}
                  >
                    {renderRunningText(layout.headerText, i + 1, docPageCount)}
                  </div>
                )}
                {layout.footerText.trim() && (
                  <div
                    className="docs-running-head"
                    style={{
                      position: "absolute",
                      bottom: Math.max(8, pageDims.marginPx * 0.4),
                      left: pageDims.marginPx,
                      right: pageDims.marginPx,
                    }}
                  >
                    {renderRunningText(layout.footerText, i + 1, docPageCount)}
                  </div>
                )}
              </div>
            ))}

            {/* Single editor instance overlaid on all pages */}
            <EditorContent
              editor={editor}
              className="docs-editor-host"
              style={{
                position:   "relative",
                zIndex:     1,
                padding:    `${pageDims.marginPx}px`,
                minHeight:  docPageCount * pageDims.hPx + (docPageCount - 1) * pageDims.gap,
                fontFamily: layout.fontFamily,
                fontSize:   `${layout.fontSize}px`,
                lineHeight: layout.lineHeight,
                color:      "#1f1f1f",
                background: "transparent",
                // Consumed by `.docs-editor p` (and friends) for block spacing.
                ["--docs-para-space" as string]: `${layout.paragraphSpacing}em`,
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        .docs-editor h1 { font-size: 2em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .docs-editor h2 { font-size: 1.5em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .docs-editor h3 { font-size: 1.25em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .docs-editor h4 { font-size: 1.1em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .docs-editor p { margin: var(--docs-para-space, 0.4em) 0; }
        .docs-editor ul, .docs-editor ol { padding-left: 1.6em; margin: var(--docs-para-space, 0.4em) 0; }
        .docs-editor .docs-page-spacer { margin: 0 !important; padding: 0 !important; border: 0 !important; }
        .docs-editor tr.docs-page-spacer-row,
        .docs-editor tr.docs-page-spacer-row td {
          border: 0 !important;
          padding: 0 !important;
          background: transparent !important;
        }
        .docs-editor tr.docs-page-spacer-row td:after { content: none !important; }
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
        .docs-editor img.ProseMirror-selectednode { outline: 2px solid #1a73e8; }
        .docs-editor table.s62-table {
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0.6em 0;
          width: 100%;
          overflow: hidden;
        }
        .docs-editor table.s62-table td,
        .docs-editor table.s62-table th {
          border: 1px solid #d0d4d8;
          padding: 0.4em 0.6em;
          min-width: 50px;
          vertical-align: top;
          position: relative;
          box-sizing: border-box;
        }
        .docs-editor table.s62-table th {
          background: #f1f3f4;
          font-weight: 600;
          text-align: left;
        }
        .docs-editor table.s62-table .selectedCell:after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(26,115,232,0.12);
          pointer-events: none;
        }
        .docs-editor table.s62-table .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background: #1a73e8;
          cursor: col-resize;
        }
        .docs-editor hr {
          border: none;
          border-top: 1px solid #d0d4d8;
          margin: 1em 0;
        }
        .docs-editor mark { background-color: #fef7e0; }
        .docs-page-break { display: block; }
        .docs-running-head {
          font-size: 11px;
          line-height: 1.3;
          color: #80868b;
          display: flex;
          justify-content: space-between;
          gap: 1em;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded transition ${
        disabled ? "opacity-30 cursor-not-allowed" :
        active ? "bg-accent-soft text-accent" : "text-app-muted hover:bg-app-hover"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-app" />;
}

function PageSetup({
  layout,
  setLayout,
}: {
  layout: DocsLayout;
  setLayout: Dispatch<SetStateAction<DocsLayout>>;
}) {
  const [open, setOpen] = useState(false);
  const isPreset = MARGIN_PRESETS.some((m) => m.value === layout.marginIn);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Page setup"
        className={`flex h-7 items-center gap-1 rounded border border-app px-2 text-[11px] transition ${
          open ? "bg-accent-soft text-accent" : "bg-app text-app-muted hover:bg-app-hover"
        }`}
      >
        <Settings2 className="h-3.5 w-3.5" />
        {PAGE_SIZES[layout.pageSize].name.split(" ")[0]}
      </button>
      {open && (
        <>
          {/* Click-away layer */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full z-40 mt-1 w-60 space-y-3 rounded-md border border-app bg-app-elevated p-3 text-[11px] shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <label className="block">
              <span className="mb-1 block font-medium text-app-subtle">Page size</span>
              <select
                value={layout.pageSize}
                onChange={(e) =>
                  setLayout((cur) => ({ ...cur, pageSize: e.target.value as PageSize }))
                }
                className="h-7 w-full rounded border border-app bg-app px-1"
              >
                {(Object.keys(PAGE_SIZES) as PageSize[]).map((key) => (
                  <option key={key} value={key}>
                    {PAGE_SIZES[key].name}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block font-medium text-app-subtle">Orientation</span>
              <div className="flex gap-1">
                {(["portrait", "landscape"] as Orientation[]).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setLayout((cur) => ({ ...cur, orientation: o }))}
                    className={`flex-1 rounded border px-2 py-1 capitalize transition ${
                      layout.orientation === o
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-app bg-app text-app-muted hover:bg-app-hover"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block font-medium text-app-subtle">Margins</span>
              <select
                value={isPreset ? String(layout.marginIn) : "custom"}
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  setLayout((cur) => ({ ...cur, marginIn: Number(e.target.value) }));
                }}
                className="h-7 w-full rounded border border-app bg-app px-1"
              >
                {MARGIN_PRESETS.map((m) => (
                  <option key={m.value} value={String(m.value)}>
                    {m.label}
                  </option>
                ))}
                {!isPreset && <option value="custom">Custom ({layout.marginIn}")</option>}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 flex items-center justify-between font-medium text-app-subtle">
                <span>Custom margin</span>
                <span className="text-app-faint">{layout.marginIn}"</span>
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={layout.marginIn}
                onChange={(e) =>
                  setLayout((cur) => ({ ...cur, marginIn: Number(e.target.value) }))
                }
                className="w-full accent-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block font-medium text-app-subtle">Line spacing</span>
                <select
                  value={layout.lineHeight}
                  onChange={(e) =>
                    setLayout((cur) => ({ ...cur, lineHeight: Number(e.target.value) }))
                  }
                  className="h-7 w-full rounded border border-app bg-app px-1"
                >
                  {LINE_SPACINGS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-app-subtle">Paragraph gap</span>
                <select
                  value={layout.paragraphSpacing}
                  onChange={(e) =>
                    setLayout((cur) => ({
                      ...cur,
                      paragraphSpacing: Number(e.target.value),
                    }))
                  }
                  className="h-7 w-full rounded border border-app bg-app px-1"
                >
                  {PARAGRAPH_SPACINGS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="border-t border-app pt-2">
              <label className="block">
                <span className="mb-1 block font-medium text-app-subtle">Header</span>
                <input
                  type="text"
                  value={layout.headerText}
                  onChange={(e) =>
                    setLayout((cur) => ({ ...cur, headerText: e.target.value }))
                  }
                  placeholder="e.g. Report title"
                  className="h-7 w-full rounded border border-app bg-app px-2"
                />
              </label>
              <label className="mt-2 block">
                <span className="mb-1 block font-medium text-app-subtle">Footer</span>
                <input
                  type="text"
                  value={layout.footerText}
                  onChange={(e) =>
                    setLayout((cur) => ({ ...cur, footerText: e.target.value }))
                  }
                  placeholder="e.g. Confidential | Page #"
                  className="h-7 w-full rounded border border-app bg-app px-2"
                />
              </label>
              <p className="mt-1.5 text-[10px] leading-snug text-app-faint">
                Use <code>#</code> or <code>{"{page}"}</code> for the page number,{" "}
                <code>{"{pages}"}</code> for the total, and <code>|</code> to split
                left · center · right.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
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
    "#1f1f1f", "#5f6368", "#ea4335", "#fbbc04", "#34a853", "#1a73e8", "#a142f4",
    "#ffffff", "#fef7e0", "#e8f5e8", "#e8f0fe", "#fce8e6",
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

/**
 * Render header/footer text for a given page. Supports page-number tokens
 * — `{page}` / `#` for the current page and `{pages}` for the total — and
 * up to three `|`-separated segments laid out left · center · right.
 */
function renderRunningText(template: string, page: number, total: number) {
  const fill = (s: string) =>
    s
      .replace(/\{pages\}/gi, String(total))
      .replace(/\{page\}/gi, String(page))
      .replace(/#/g, String(page));
  const parts = template.split("|").map((p) => fill(p.trim()));
  if (parts.length >= 3) {
    return (
      <>
        <span style={{ flex: 1, textAlign: "left" }}>{parts[0]}</span>
        <span style={{ flex: 1, textAlign: "center" }}>{parts[1]}</span>
        <span style={{ flex: 1, textAlign: "right" }}>{parts[2]}</span>
      </>
    );
  }
  if (parts.length === 2) {
    return (
      <>
        <span style={{ textAlign: "left" }}>{parts[0]}</span>
        <span style={{ textAlign: "right" }}>{parts[1]}</span>
      </>
    );
  }
  return <span>{parts[0]}</span>;
}
