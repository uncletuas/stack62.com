import {
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
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";

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
        class: "docs-editor outline-none",
        style: `min-height: 100%; font-family: ${layout.fontFamily}; font-size: ${layout.fontSize}px; line-height: 1.6;`,
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
    editor.commands.insertContent(`<img src="${url}" alt="Image" />`);
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
    let html = '<table class="s62-table"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += "</tbody></table><p></p>";
    editor.commands.insertContent(html);
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

      <div className="min-h-0 flex-1 overflow-auto py-6">
        <div
          className="mx-auto bg-white text-[#1f1f1f] shadow-[0_2px_8px rgba(0,0,0,0.15)]"
          style={{
            ...pageStyle,
            transform: `scale(${Math.max(0.5, zoom / 100)})`,
            transformOrigin: "top center",
          }}
        >
          <EditorContent editor={editor} />
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
        .docs-editor mark { background-color: #fef7e0; }
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
