import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bold,
  Download,
  FileText,
  Image as ImageIcon,
  Italic,
  ExternalLink,
  LayoutPanelTop,
  Loader2,
  Plus,
  Presentation,
  Printer,
  Quote,
  Save,
  Sheet,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { appDialog } from "../../components/app-dialog";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../context/app-context";
import {
  fetchFileBlobUrl,
  fetchDocument,
  fetchFileContent,
  fileDownloadUrl,
  deleteFile,
  listFiles,
  openInGoogleWorkspace,
  updateDocument,
  saveFileContent,
  uploadFile,
  type EditableFileContent,
  type StoredFile,
  type WorkspaceDocument,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { DocsEditor } from "./DocsEditor";
import { SheetEditor } from "./SheetEditor";
import { SlidesEditor } from "./SlidesEditor";

const EDITABLE_RE = /\.(docx|xlsx|xls|pptx|txt|md|csv|json|js|ts|tsx|html|css|sql|yaml|yml|xml|log|rtf)$/i;

type SavingState = "idle" | "saving" | "saved" | "error";
type SurfaceKind = "document" | "sheet" | "slides" | "pdf" | "image" | "text" | "unsupported";

interface ParsedSheet {
  name: string;
  data: string[][];
}
interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

export function FileEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, navigate, updateTab, fileDrafts } = useWorkspace();
  const [stored, setStored] = useState<StoredFile | null>(null);
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [editableContent, setEditableContent] = useState<EditableFileContent | null>(null);
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [docxUrl, setDocxUrl] = useState<string | null>(null);
  /** Real workbook data when the file is an .xlsx/.xls — parsed client-side
   *  with SheetJS so the user sees the actual rows, not the lossy CSV
   *  conversion. Saving still goes back as CSV; the backend re-encodes. */
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<SavingState>("idle");
  const [zoom, setZoom] = useState(92);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  const surface = useMemo(
    () => (document ? "document" : getSurfaceKind(stored, editableContent)),
    [document, stored, editableContent],
  );

  useEffect(() => {
    let revoked: string | null = null;
    if (!tab.refId || !currentOrganization) {
      setStored(null);
      setDocument(null);
      setEditableContent(null);
      setContent("");
      setImageUrl(null);
      setPdfUrl(null);
      setDocxUrl(null);
      return;
    }

    let live = true;
    setLoading(true);
    setSaving("idle");
    setDocument(null);
    setEditableContent(null);
    setImageUrl(null);
    setPdfUrl(null);
    setDocxUrl(null);
    setContent("");
    setWorkbook(null);
    setActiveSheetIndex(0);

    if (tab.kind === "document") {
      void fetchDocument(tab.refId)
        .then((doc) => {
          if (!live) return;
          setDocument(doc);
          setContent(doc.content);
          setSaving("saved");
        })
        .finally(() => live && setLoading(false));
      return () => {
        live = false;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
      };
    }

    void listFiles({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then(async (all) => {
        if (!live) return;
        const file = all.find((f) => f.id === tab.refId) ?? null;
        setStored(file);
        if (!file) return;

        if (file.mimeType.startsWith("image/")) {
          const url = await fetchFileBlobUrl(file.id).catch(() => null);
          revoked = url;
          if (live && url) setImageUrl(url);
          return;
        }

        if (file.mimeType === "application/pdf" || /\.pdf$/i.test(file.filename)) {
          const url = await fetchFileBlobUrl(file.id).catch(() => null);
          revoked = url;
          if (live && url) setPdfUrl(url);
          return;
        }

        // DOCX: fetch the original .docx binary so docx-preview can render
        // it with formatting preserved. We still load the extracted-text
        // version below for fallback / AI-assist features.
        if (/\.docx$/i.test(file.filename)) {
          const url = await fetchFileBlobUrl(file.id).catch(() => null);
          revoked = url;
          if (live && url) setDocxUrl(url);
        }

        // Real spreadsheet path: parse xlsx/xls binaries client-side with
        // SheetJS so we get every sheet, every row, types intact.
        if (/\.(xlsx|xls)$/i.test(file.filename)) {
          const url = await fetchFileBlobUrl(file.id).catch(() => null);
          revoked = url;
          if (live && url) {
            try {
              const buf = await fetch(url).then((r) => r.arrayBuffer());
              const wb = XLSX.read(buf, { type: "array", cellDates: true });
              const sheets = wb.SheetNames.map((name) => {
                const sheet = wb.Sheets[name];
                const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
                  header: 1,
                  defval: "",
                  blankrows: false,
                  raw: false,
                });
                return {
                  name,
                  data: aoa.map((row) => row.map((c) => String(c ?? ""))),
                };
              });
              if (live) {
                setWorkbook({ sheets });
                setEditableContent({
                  fileId: file.id,
                  filename: file.filename,
                  mimeType: file.mimeType,
                  editable: true,
                  format: "xlsx",
                  text: sheets[0] ? toCsv(sheets[0].data) : "",
                });
                setContent(sheets[0] ? toCsv(sheets[0].data) : "");
                setSaving("saved");
              }
              return;
            } catch (err) {
              appendRunLog({
                level: "error",
                text: `Could not parse spreadsheet: ${(err as Error).message}. Falling back to text.`,
                source: "files",
              });
            }
          }
        }

        if (EDITABLE_RE.test(file.filename)) {
          const doc = await fetchFileContent(file.id).catch(() => null);
          if (live && doc) {
            setEditableContent(doc);
            setContent(doc.text);
            setSaving("saved");
          }
        }
      })
      .finally(() => live && setLoading(false));

    return () => {
      live = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [tab.kind, tab.refId, currentOrganization?.id, currentWorkspace?.id]);

  // Refetch when the coworker signals a possible external change. We
  // skip the refetch if the user has unsaved local edits ("saving")
  // because we'd otherwise stomp on their typing; the autosave will
  // land moments later and the next coworker turn will pick it up.
  useEffect(() => {
    if (!tab.refId) return;
    const handler = (event: Event) => {
      const ev = event as CustomEvent<{ tabKind: string | null; refId: string | null }>;
      const detail = ev.detail ?? { tabKind: null, refId: null };
      // Only refetch if the signal matches the doc/file we're showing.
      if (detail.refId && detail.refId !== tab.refId) return;
      if (saving === "saving") return;
      if (tab.kind === "document") {
        void fetchDocument(tab.refId!).then((doc) => {
          setDocument(doc);
          setContent(doc.content);
          setSaving("saved");
        }).catch(() => { /* ignore */ });
      } else if (tab.kind === "file" && stored?.id && EDITABLE_RE.test(stored.filename)) {
        void fetchFileContent(stored.id).then((doc) => {
          setEditableContent(doc);
          setContent(doc.text);
          setSaving("saved");
        }).catch(() => { /* ignore */ });
      }
    };
    window.addEventListener("stack62:editor-refresh", handler);
    return () => window.removeEventListener("stack62:editor-refresh", handler);
  }, [tab.kind, tab.refId, stored?.id, stored?.filename, saving]);

  const onUpload = async (list: FileList | null) => {
    if (!list || !currentOrganization) return;
    for (const file of Array.from(list)) {
      try {
        const uploaded = await uploadFile({
          file,
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace?.id,
          scope: "attachment",
          ownerKind: "explorer",
        });
        appendRunLog({ level: "ok", text: `Opened ${file.name}`, source: "files" });
        if (!tab.refId) updateTab(tab.id, { title: uploaded.filename, refId: uploaded.id });
        else navigate({ kind: "file", title: uploaded.filename, refId: uploaded.id });
      } catch (err) {
        appendRunLog({
          level: "error",
          text: `Open failed: ${(err as Error).message}`,
          source: "files",
        });
      }
    }
  };

  const queueSave = (next: string) => {
    setContent(next);
    if (document?.id) {
      setSaving("saving");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void updateDocument(document.id, {
          content: next,
          changeSummary: "Autosaved from Explorer",
        })
          .then((saved) => {
            setDocument(saved);
            setSaving("saved");
          })
          .catch((err) => {
            setSaving("error");
            appendRunLog({
              level: "error",
              text: `Save failed: ${(err as Error).message}`,
              source: "documents",
            });
          });
      }, 700);
      return;
    }
    if (!stored?.id || !editableContent) return;
    setSaving("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveFileContent(stored.id, next)
        .then((saved) => {
          setEditableContent(saved);
          setSaving("saved");
        })
        .catch((err) => {
          setSaving("error");
          appendRunLog({
            level: "error",
            text: `Save failed: ${(err as Error).message}`,
            source: "files",
          });
        });
    }, 700);
  };

  const removeFile = async () => {
    if (!stored?.id) return;
    setSaving("saving");
    try {
      await deleteFile(stored.id);
      appendRunLog({ level: "ok", text: `Deleted ${stored.filename}`, source: "files" });
      navigate({ kind: "welcome", title: "Workspace" });
    } catch (err) {
      setSaving("error");
      appendRunLog({
        level: "error",
        text: `Delete failed: ${(err as Error).message}`,
        source: "files",
      });
    }
  };

  const openGoogle = async () => {
    if (!currentOrganization) return;
    const sourceId = document?.id ?? stored?.id;
    if (!sourceId) return;

    // Open the popup synchronously inside the click handler so the browser
    // doesn't block it as a non-user-initiated popup. We'll point the popup
    // at the final URL after the async call completes.
    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.write(
        `<!doctype html><meta charset="utf-8"><title>Opening in Google…</title>
         <style>body{font:14px system-ui;color:#374151;background:#fafafa;display:grid;place-items:center;height:100vh;margin:0}</style>
         <div>Opening "${displayName.replace(/[<>"]/g, "")}" in Google Workspace…</div>`,
      );
    }

    try {
      const result = await openInGoogleWorkspace({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        title: displayName,
        content,
        kind: googleKind(surface),
        sourceId,
        sourceType: document ? "document" : "file",
      });
      if (document) {
        await updateDocument(document.id, {
          metadata: {
            ...(document.metadata ?? {}),
            googleFileId: result.id,
            googleWebViewLink: result.webViewLink,
            googleMimeType: result.mimeType,
          },
          changeSummary: "Linked to Google Workspace",
        }).catch(() => null);
      }
      appendRunLog({
        level: "ok",
        text: `Opened ${displayName} in Google Workspace`,
        source: "integrations",
      });
      if (popup) popup.location.href = result.webViewLink;
      else window.open(result.webViewLink, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = (err as Error).message ?? "Open failed";
      const notConnected =
        /no .*google.*connection|no active connection|not configured|access token|unauthor/i.test(
          message,
        );
      appendRunLog({
        level: "error",
        text: notConnected
          ? "Google Workspace isn't connected for this org. Open Settings → Integrations to connect."
          : `Google open failed: ${message}`,
        source: "integrations",
      });
      if (popup) {
        if (notConnected) {
          // Redirect the popup to the connect screen.
          popup.document.body.innerHTML = `
            <div style="font:14px system-ui;color:#374151;background:#fafafa;display:grid;place-items:center;height:100vh;margin:0;padding:24px;text-align:center">
              <div>
                <div style="font-size:18px;font-weight:600;margin-bottom:8px">Connect Google Workspace</div>
                <p style="margin:0 0 12px;max-width:460px">To open files in Google Docs/Sheets/Slides, an admin needs to connect Google Workspace from Settings → Integrations.</p>
                <button onclick="window.close()" style="padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer">Close</button>
              </div>
            </div>`;
        } else {
          popup.close();
        }
      }
      // Surface the connect path inside the app too.
      if (notConnected) {
        navigate({
          kind: "settings",
          title: "Settings · Integrations",
          refId: "integrations",
        });
      }
    }
  };

  const displayName = document?.title ?? stored?.filename ?? tab.title;

  if (!tab.refId) return <EmptyFileState inputRef={inputRef} onUpload={onUpload} draft={fileDrafts[tab.id]} />;

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <FileWorkbenchHeader
        file={stored}
        title={displayName}
        saving={saving}
        surface={surface}
        zoom={zoom}
        setZoom={setZoom}
        onDelete={removeFile}
        onOpenGoogle={openGoogle}
      />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto bg-[#111827]">
          {loading ? (
            <div className="grid h-full place-items-center text-app-faint">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !stored && !document ? (
            <EmptyMessage text="Item not available." />
          ) : surface === "image" && imageUrl ? (
            <ImageSurface filename={stored.filename} url={imageUrl} />
          ) : surface === "pdf" && pdfUrl ? (
            <PdfSurface filename={stored.filename} url={pdfUrl} />
          ) : surface === "sheet" ? (
            <SheetEditor text={content} onChange={queueSave} title={displayName} />
          ) : surface === "slides" ? (
            <SlidesEditor text={content} onChange={queueSave} title={displayName} />
          ) : surface === "document" ? (
            docxUrl && stored ? (
              <DocxSurface
                url={docxUrl}
                filename={stored.filename}
                onPersist={(next) => {
                  // Push the edited text through the existing save
                  // pipeline so it lands as a new docx on the backend
                  // and version chain.
                  queueSave(next);
                }}
              />
            ) : (
              <DocsEditor
                text={content}
                onChange={queueSave}
                zoom={zoom}
                documentId={document?.id ?? null}
                title={displayName}
              />
            )
          ) : surface === "text" ? (
            <TextSurface text={content} onChange={queueSave} />
          ) : (
            <EmptyMessage text="Preview unavailable for this file type. Download it or ask the coworker to convert it." />
          )}
        </main>

        <Inspector file={stored} surface={surface} content={content} />
      </div>
    </div>
  );
}

function FileWorkbenchHeader({
  file,
  title,
  saving,
  surface,
  zoom,
  setZoom,
  onDelete,
  onOpenGoogle,
}: {
  file: StoredFile | null;
  title: string;
  saving: SavingState;
  surface: SurfaceKind;
  zoom: number;
  setZoom: (zoom: number) => void;
  onDelete: () => void;
  onOpenGoogle: () => void;
}) {
  const Icon =
    surface === "sheet"
      ? Table2
      : surface === "slides"
        ? Presentation
        : surface === "image"
          ? ImageIcon
          : FileText;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app bg-app px-4">
      <Icon className="h-4 w-4 text-cyan-300" />
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{file?.filename ?? title}</h1>
        <p className="text-[11px] text-app-faint">
          {file?.mimeType ?? "file"}
          {saving !== "idle" && (
            <span className={`ml-2 ${saving === "error" ? "text-rose-300" : "text-cyan-300"}`}>
              {saving === "saving" ? "saving" : saving === "saved" ? "saved" : "save failed"}
            </span>
          )}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ToolbarButton title="Bold" icon={Bold} />
        <ToolbarButton title="Italic" icon={Italic} />
        <ToolbarButton title="Text" icon={Type} />
        <ToolbarButton title="Print" icon={Printer} onClick={() => window.print()} />
        {["document", "sheet", "slides", "text"].includes(surface) && (
          <button
            type="button"
            onClick={onOpenGoogle}
            title="Open in Google"
            className="ml-1 inline-flex h-8 items-center gap-1 rounded border border-app bg-app-surface px-2 text-xs text-app-muted hover:border-cyan-700 hover:text-cyan-100"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Google
          </button>
        )}
        <label className="ml-2 text-[11px] text-app-faint">Zoom</label>
        <input
          type="range"
          min={70}
          max={120}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="w-24 accent-cyan-400"
        />
        <span className="w-9 text-right text-[11px] text-app-subtle">{zoom}%</span>
        {file?.id && (
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className="ml-2 grid h-8 w-8 place-items-center rounded border border-rose-900/60 bg-rose-950/20 text-rose-300 hover:border-rose-700 hover:text-rose-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {file?.id && (
          <a
            href={fileDownloadUrl(file.id)}
            target="_blank"
            rel="noreferrer"
            className="ml-2 grid h-8 w-8 place-items-center rounded border border-app bg-app-surface text-app-muted hover:border-app-strong hover:text-white"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
        )}
      </div>
    </header>
  );
}

function ToolbarButton({
  title,
  icon: Icon,
  onClick,
}: {
  title: string;
  icon: typeof Save;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded text-app-subtle hover:bg-app-elevated hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* ── Document layout (Google-Docs-style page model) ─────────────────────── */

const PAGE_SIZES: Record<string, { name: string; widthIn: number; heightIn: number }> = {
  letter:  { name: "Letter (8.5\" × 11\")",  widthIn: 8.5,  heightIn: 11 },
  a4:      { name: "A4 (210 × 297 mm)",      widthIn: 8.27, heightIn: 11.69 },
  legal:   { name: "Legal (8.5\" × 14\")",   widthIn: 8.5,  heightIn: 14 },
  tabloid: { name: "Tabloid (11\" × 17\")",  widthIn: 11,   heightIn: 17 },
  a5:      { name: "A5 (148 × 210 mm)",      widthIn: 5.83, heightIn: 8.27 },
};

const FONT_FAMILIES = [
  { value: "'Inter', 'Arial', sans-serif",                  label: "Inter (sans)" },
  { value: "'Merriweather', 'Georgia', serif",              label: "Merriweather (serif)" },
  { value: "'Roboto', 'Arial', sans-serif",                 label: "Roboto" },
  { value: "'Source Serif Pro', 'Georgia', serif",          label: "Source Serif" },
  { value: "Georgia, 'Times New Roman', serif",             label: "Georgia" },
  { value: "ui-monospace, SFMono-Regular, Menlo, monospace", label: "Mono" },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 60];

interface DocLayout {
  pageSize: keyof typeof PAGE_SIZES;
  orientation: "portrait" | "landscape";
  marginIn: number;
  fontFamily: string;
  fontSize: number;
}

const DEFAULT_LAYOUT: DocLayout = {
  pageSize: "letter",
  orientation: "portrait",
  marginIn: 1,
  fontFamily: FONT_FAMILIES[0].value,
  fontSize: 14,
};

const PAGE_BREAK_MARK = '<hr data-page-break="1" />';

/**
 * Google-Docs-style rich-text editor with real, multi-page rendering.
 * Pages are persisted as a single HTML string separated by
 * <hr data-page-break="1" /> markers. Each page is rendered as an
 * independent contentEditable on its own paper-sized sheet, so paging never
 * breaks a paragraph in half — the user explicitly inserts page breaks via
 * Ctrl+Enter or the "Insert page break" toolbar button.
 *
 * On overflow (content taller than the page), we scroll the page-card; the
 * user can split with a page break to push subsequent content to a new
 * sheet. This matches how Word/Docs feel without requiring intricate
 * pagination algorithms.
 */
/**
 * Google-Docs-style rich text editor. A single contentEditable so
 * formatting commands work reliably across the whole document, with a
 * paginated *visual* layout via CSS (one tall column with page breaks
 * styled in). Toolbar buttons preserve selection by handling
 * `onMouseDown` with `preventDefault` instead of `onClick` — without
 * that, the editor loses focus before `execCommand` runs and every
 * command silently fails (this was the "actions are not working" bug).
 *
 * Coworker control: listens to `window.stack62:doc-command` events so
 * the AI can directly drive the editor — get content, insert at cursor,
 * apply formatting, replace selection. Each command can target a
 * specific documentId or fall through to the focused doc.
 */
function DocsButton({
  title,
  onClick,
  onAction,
  active,
  children,
}: {
  title: string;
  onClick?: () => void;
  /** Preferred handler for contentEditable-aware toolbars. Fires on
   *  mousedown so the editor's selection is preserved across the
   *  click. Use this when the action depends on selection state. */
  onAction?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={
        onAction
          ? (e) => {
              e.preventDefault();
              onAction();
            }
          : undefined
      }
      onClick={onAction ? undefined : onClick}
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
function ToolbarDivider() {
  return (
    <span
      className="mx-1 h-5 w-px"
      style={{ backgroundColor: "var(--app-border-strong)" }}
    />
  );
}
function ToolbarSelect({
  label,
  value,
  options,
  onPick,
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
      className="h-7 max-w-[180px] rounded border border-app bg-app-elevated px-2 text-[11px] text-app hover:border-app-strong focus:border-cyan-400/50 focus:outline-none"
    >
      {value === undefined && (
        <option value="" disabled>
          {label}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function isHtml(s: string) {
  return /<\/?[a-z][\s\S]*>/i.test(s ?? "");
}
function escapeText(s: string) {
  if (!s) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replace(/\n/g, "<br/>");
}

/**
 * Sheets-style spreadsheet surface. Adds a formula bar, cell selection,
 * keyboard navigation (arrows / enter / tab), simple per-cell formatting
 * (bold, italic, alignment, background fill), and add-row/column controls.
 *
 * Storage shape stays CSV-compatible: we serialize values as the cell text;
 * formatting is stored alongside the values in a leading metadata line if
 * any cells are formatted, so plain-CSV ingest still works.
 */
type CellFormat = {
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  bg?: string;
};
type SheetState = {
  data: string[][];
  formats: Record<string, CellFormat>;
};

function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

function TextSurface({ text, onChange }: { text: string; onChange: (next: string) => void }) {
  return (
    <div className="h-full p-5">
      <textarea
        value={text}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-h-[720px] w-full resize-none rounded border border-app bg-app p-5 font-mono text-sm leading-6 text-emerald-100 outline-none focus:border-cyan-700"
      />
    </div>
  );
}

/**
 * PDF surface — renders each page to a canvas via pdf.js so the file
 * looks exactly like its source: real page boundaries, real fonts, real
 * layout. The old <iframe> behaviour varied by browser and disabled our
 * own scroll/zoom controls. We host pdf.js's worker via Vite's URL
 * import so it bundles correctly without runtime path tricks.
 */
function PdfSurface({ filename, url }: { filename: string; url: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const host = containerRef.current;
    if (!host) return;

    host.innerHTML = "";
    setError(null);
    setPageCount(0);

    (async () => {
      try {
        // Vite resolves these to bundled assets at build time.
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import(
          "pdfjs-dist/build/pdf.worker.mjs?url"
        )) as { default: string };
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          if (cancelled) break;
          const page = await doc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.3 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 16px";
          canvas.style.background = "white";
          canvas.style.boxShadow = "0 4px 16px rgba(0,0,0,0.18)";
          host.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }

        cleanup = () => {
          doc.destroy();
        };
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [url]);

  if (error) {
    // Last-resort fallback: native iframe if pdfjs can't render.
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-app bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          PDF.js failed ({error}); falling back to native viewer.
        </div>
        <iframe
          title={filename}
          src={url}
          className="h-full min-h-[680px] w-full bg-white"
        />
      </div>
    );
  }

  const print = () => {
    const w = window.open(url, "_blank");
    w?.addEventListener("load", () => w.print());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-app px-4 py-1.5 text-[11px] text-app-faint">
        <span className="flex-1">
          {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "Loading PDF…"}
        </span>
        <a
          href={url}
          download={filename}
          className="rounded border border-app bg-app-surface px-2 py-0.5 text-[11px] text-app hover:bg-app-hover"
          title="Download the original PDF"
        >
          Download
        </a>
        <button
          type="button"
          onClick={print}
          className="rounded border border-app bg-app-surface px-2 py-0.5 text-[11px] text-app hover:bg-app-hover"
          title="Open print dialog"
        >
          Print
        </button>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-app-hover p-4"
      />
    </div>
  );
}

/**
 * DOCX surface — renders the original document with formatting
 * preserved (paragraphs, headings, tables, images) using docx-preview.
 * Replaces the previous "plain text in a textarea" view that lost all
 * structure.
 */
/**
 * DOCX surface — renders the file with formatting preserved via
 * docx-preview, and toggles into an in-place editable mode.
 *
 * Edit mode: we make the rendered DOM contenteditable so the user
 * can type into headings/paragraphs/tables. Save serialises the
 * HTML through `onPersist` — the backend re-encodes that into a
 * docx server-side. Cancel reverts by re-rendering the original.
 */
function DocxSurface({
  url,
  filename,
  onPersist,
}: {
  url: string;
  filename: string;
  onPersist?: (htmlOrText: string) => void | Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const renderOnce = useCallback(async () => {
    const host = containerRef.current;
    if (!host) return;
    host.innerHTML = "";
    setError(null);
    setLoaded(false);
    try {
      const docx = await import("docx-preview");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      await docx.renderAsync(buffer, host, undefined, {
        className: "stack62-docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        experimental: false,
        useBase64URL: true,
      });
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    void renderOnce().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [renderOnce]);

  const beginEdit = () => {
    setEditing(true);
    const host = containerRef.current;
    if (host) host.contentEditable = "true";
  };

  const save = async () => {
    if (!onPersist) {
      // No persist hook (e.g. system-asset file viewed outside our save
      // path) — just exit edit mode to avoid losing the user's work.
      setEditing(false);
      const host = containerRef.current;
      if (host) host.contentEditable = "false";
      return;
    }
    setSaving(true);
    try {
      const host = containerRef.current;
      // Strip the .stack62-docx wrapper attributes that aren't real
      // body content. The backend converts incoming HTML / plain text
      // back into docx via its existing editable-content saver.
      const plain =
        host?.innerText?.trim() ?? host?.textContent?.trim() ?? "";
      await onPersist(plain);
      setEditing(false);
      if (host) host.contentEditable = "false";
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    setEditing(false);
    const host = containerRef.current;
    if (host) host.contentEditable = "false";
    await renderOnce();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-app px-4 py-1.5 text-[11px] text-app-faint">
        <span className="flex-1 truncate">
          {error
            ? `Could not render: ${error}`
            : loaded
              ? filename
              : "Rendering document…"}
        </span>
        {loaded && !error && !editing && (
          <button
            type="button"
            onClick={beginEdit}
            className="rounded border border-app bg-app-surface px-2 py-0.5 text-[11px] text-app hover:bg-app-hover"
            title="Edit document"
          >
            Edit
          </button>
        )}
        {editing && (
          <>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              Editing
            </span>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded border border-app bg-app-surface px-2 py-0.5 text-[11px] text-app hover:bg-app-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-cyan-500 px-2 py-0.5 text-[11px] font-medium text-slate-950 hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-200/40 p-4 dark:bg-slate-900/40">
        <div
          ref={containerRef}
          className={`mx-auto bg-white text-slate-900 shadow-xl outline-none [&_.stack62-docx]:bg-white ${
            editing ? "ring-2 ring-cyan-400" : ""
          }`}
          style={{ maxWidth: 920 }}
          // suppressContentEditableWarning is set when we toggle the
          // editable mode programmatically; we don't lock the DOM
          // structure since users can paste rich content.
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}

function ImageSurface({ filename, url }: { filename: string; url: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <img src={url} alt={filename} className="max-h-full max-w-full object-contain shadow-2xl" />
    </div>
  );
}

function Inspector({
  file,
  surface,
  content,
}: {
  file: StoredFile | null;
  surface: SurfaceKind;
  content: string;
}) {
  const stats = getStats(surface, content);
  return (
    <aside className="hidden w-64 shrink-0 border-l border-app bg-app p-4 text-xs text-app-subtle xl:block">
      <h2 className="text-sm font-semibold text-white">Properties</h2>
      <dl className="mt-4 space-y-3">
        <Info label="Type" value={surface} />
        <Info label="Size" value={file ? `${Math.ceil(Number(file.size) / 1024)} KB` : "-"} />
        <Info label="Updated" value={file ? new Date(file.updatedAt).toLocaleString() : "-"} />
        {stats.map((item) => <Info key={item.label} label={item.label} value={item.value} />)}
      </dl>
      <div className="mt-6 rounded border border-cyan-900/50 bg-cyan-950/20 p-3 text-cyan-100">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-3.5 w-3.5" /> Coworker-ready
        </div>
        <p className="mt-2 leading-5 text-cyan-100/70">
          The coworker can read, summarize, rewrite, and update supported files through the same document engine.
        </p>
      </div>
    </aside>
  );
}

function EmptyFileState({
  inputRef,
  onUpload,
  draft,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  onUpload: (files: FileList | null) => void;
  draft?: { format?: string; title?: string };
}) {
  return (
    <div className="grid h-full place-items-center bg-app text-app">
      <div className="max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500/15 text-cyan-300">
          <LayoutPanelTop className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold">Open a business file</h1>
        <p className="mt-1 text-sm text-app-subtle">
          Work with documents, spreadsheets, decks, PDFs, images, and data files directly in Stack62.
        </p>
        {draft && (draft.format || draft.title) && (
          <p className="mt-3 text-xs text-app-faint">
            {draft.format?.toUpperCase()}
            {draft.title ? ` - ${draft.title}` : ""}
          </p>
        )}
        <Button onClick={() => inputRef.current?.click()} variant="outline" className="mt-5 gap-2">
          <Upload className="h-4 w-4" /> Upload from computer
        </Button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => void onUpload(e.target.files)} />
      </div>
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return <div className="grid h-full place-items-center p-8 text-center text-sm text-app-faint">{text}</div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase text-app-faint">{label}</dt>
      <dd className="mt-1 break-words text-app-muted">{value}</dd>
    </div>
  );
}

function getSurfaceKind(file: StoredFile | null, doc: EditableFileContent | null): SurfaceKind {
  if (!file) return "unsupported";
  const lower = file.filename.toLowerCase();
  if (file.mimeType.startsWith("image/")) return "image";
  if (file.mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (doc?.format === "xlsx" || /\.(xlsx|xls|csv|tsv)$/i.test(lower)) return "sheet";
  if (doc?.format === "pptx" || lower.endsWith(".pptx")) return "slides";
  if (doc?.format === "docx" || /\.(docx|rtf)$/i.test(lower)) return "document";
  if (doc?.format === "text") return "text";
  return "unsupported";
}

function googleKind(surface: SurfaceKind): 'document' | 'spreadsheet' | 'presentation' | 'text' {
  if (surface === "sheet") return "spreadsheet";
  if (surface === "slides") return "presentation";
  if (surface === "text") return "text";
  return "document";
}

function getStats(surface: SurfaceKind, content: string) {
  if (surface === "sheet") return [{ label: "Rows", value: String(parseCsv(content).length) }];
  if (surface === "slides") return [{ label: "Slides", value: String(parseSlides(content).length) }];
  if (surface === "document") {
    return [
      { label: "Words", value: String(content.trim() ? content.trim().split(/\s+/).length : 0) },
      { label: "Pages", value: String(Math.max(1, Math.ceil(content.length / 2800))) },
    ];
  }
  return [{ label: "Characters", value: String(content.length) }];
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && quoted && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) {
          cells.push(cell);
          cell = "";
        } else cell += char;
      }
      cells.push(cell);
      return cells;
    });
}

function toCsv(rows: string[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}

function columnName(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

interface SlideDraft {
  title: string;
  body: string;
}

function parseSlides(text: string): SlideDraft[] {
  const chunks = text.split(/\n\s*--- slide ---\s*\n/i);
  return (chunks.length ? chunks : [text]).map((chunk) => {
    const lines = chunk.split(/\r?\n/);
    return {
      title: lines[0] || "Untitled slide",
      body: lines.slice(1).join("\n").trim(),
    };
  });
}

function serializeSlides(slides: SlideDraft[]) {
  return slides.map((slide) => `${slide.title}\n${slide.body}`.trim()).join("\n\n--- slide ---\n\n");
}
