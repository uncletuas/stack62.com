import { useEffect, useMemo, useRef, useState } from "react";
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
  Save,
  Sheet,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
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
            <SheetSurface
              text={content}
              onChange={(next) => {
                queueSave(next);
                if (workbook && workbook.sheets[activeSheetIndex]) {
                  const updated = {
                    sheets: workbook.sheets.map((s, i) =>
                      i === activeSheetIndex ? { ...s, data: parseCsv(next) } : s,
                    ),
                  };
                  setWorkbook(updated);
                }
              }}
              zoom={zoom}
              workbook={workbook}
              activeSheetIndex={activeSheetIndex}
              onSwitchSheet={(idx) => {
                setActiveSheetIndex(idx);
                if (workbook && workbook.sheets[idx]) {
                  const csv = toCsv(workbook.sheets[idx].data);
                  setContent(csv);
                }
              }}
            />
          ) : surface === "slides" ? (
            <SlidesSurface text={content} onChange={queueSave} zoom={zoom} />
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
              <DocumentSurface text={content} onChange={queueSave} zoom={zoom} />
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
function DocumentSurface({
  text,
  onChange,
  zoom,
}: {
  text: string;
  onChange: (next: string) => void;
  zoom: number;
}) {
  const scale = zoom / 100;
  const [layout, setLayout] = useState<DocLayout>(DEFAULT_LAYOUT);
  const [pages, setPages] = useState<string[]>(() => splitPages(text));
  const lastEmittedRef = useRef<string>("");

  // Hydrate when the file content changes externally.
  useEffect(() => {
    if (text === lastEmittedRef.current) return;
    setPages(splitPages(text));
  }, [text]);

  const updatePage = (index: number, html: string) => {
    setPages((cur) => {
      const next = [...cur];
      next[index] = html;
      const joined = joinPages(next);
      lastEmittedRef.current = joined;
      onChange(joined);
      return next;
    });
  };

  const insertPageBreak = (afterIndex: number) => {
    setPages((cur) => {
      const next = [...cur];
      next.splice(afterIndex + 1, 0, "");
      const joined = joinPages(next);
      lastEmittedRef.current = joined;
      onChange(joined);
      return next;
    });
  };

  const removePage = (index: number) => {
    setPages((cur) => {
      if (cur.length <= 1) return cur;
      const next = cur.filter((_, i) => i !== index);
      const joined = joinPages(next);
      lastEmittedRef.current = joined;
      onChange(joined);
      return next;
    });
  };

  const sizeIn = PAGE_SIZES[layout.pageSize];
  const isLandscape = layout.orientation === "landscape";
  const pxW = (isLandscape ? sizeIn.heightIn : sizeIn.widthIn) * 96 * scale;
  const pxH = (isLandscape ? sizeIn.widthIn : sizeIn.heightIn) * 96 * scale;
  const padPx = layout.marginIn * 96 * scale;

  return (
    <div className="min-h-full overflow-auto bg-doc-canvas">
      <DocumentToolbar
        layout={layout}
        setLayout={setLayout}
        onInsertBreak={() => {
          // Insert a break after the active page (the one with focus).
          const active = document.activeElement as HTMLElement | null;
          if (active?.dataset?.pageIndex !== undefined) {
            insertPageBreak(Number(active.dataset.pageIndex));
          } else {
            insertPageBreak(pages.length - 1);
          }
        }}
      />

      <div className="space-y-6 px-10 py-6">
        {pages.map((html, idx) => (
          <div key={idx} className="relative">
            <PageSheet
              html={html}
              widthPx={pxW}
              heightPx={pxH}
              paddingPx={padPx}
              fontFamily={layout.fontFamily}
              fontSize={layout.fontSize}
              pageIndex={idx}
              onChange={(next) => updatePage(idx, next)}
            />
            <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-app-elevated px-2 py-0.5 text-[10px] uppercase tracking-wider text-app-faint shadow-sm">
              Page {idx + 1} / {pages.length}
            </div>
            {pages.length > 1 && (
              <button
                type="button"
                onClick={() => removePage(idx)}
                className="absolute -top-3 right-4 rounded-full bg-app-elevated px-2 py-0.5 text-[10px] text-rose-400 shadow-sm hover:bg-rose-50"
                title="Delete this page"
              >
                Remove
              </button>
            )}
          </div>
        ))}

        <div className="mx-auto" style={{ width: pxW }}>
          <button
            type="button"
            onClick={() => insertPageBreak(pages.length - 1)}
            className="w-full rounded-md border border-dashed border-app-strong bg-app-elevated py-2 text-[11px] text-app-muted hover:border-cyan-400/50 hover:text-app"
          >
            + Add new page
          </button>
        </div>
      </div>

      <style>{`
        .docs-surface h1 { font-size: 1.85em; font-weight: 600; margin: 18px 0 8px; }
        .docs-surface h2 { font-size: 1.45em; font-weight: 600; margin: 16px 0 6px; }
        .docs-surface h3 { font-size: 1.2em;  font-weight: 600; margin: 14px 0 6px; }
        .docs-surface p  { margin: 6px 0; }
        .docs-surface ul, .docs-surface ol { padding-left: 28px; margin: 8px 0; }
        .docs-surface ul { list-style: disc; }
        .docs-surface ol { list-style: decimal; }
        .docs-surface li { margin: 2px 0; }
        .docs-surface blockquote {
          margin: 12px 0; padding: 6px 14px;
          border-left: 4px solid var(--app-border-strong);
          color: var(--app-text-muted);
          background: var(--app-overlay);
        }
        .docs-surface a { color: var(--app-cyan); text-decoration: underline; }
        .docs-surface code {
          background: var(--app-overlay); padding: 1px 4px; border-radius: 3px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.92em;
        }
        .docs-surface table { border-collapse: collapse; margin: 12px 0; }
        .docs-surface table td, .docs-surface table th {
          border: 1px solid var(--app-border);
          padding: 6px 10px; min-width: 60px;
        }
        .docs-surface img { max-width: 100%; height: auto; }
        .docs-surface:empty::before {
          content: "Start writing — pick a heading style, drop in an image, or paste content.";
          color: var(--app-text-faint);
        }
      `}</style>
    </div>
  );
}

function PageSheet({
  html,
  widthPx,
  heightPx,
  paddingPx,
  fontFamily,
  fontSize,
  pageIndex,
  onChange,
}: {
  html: string;
  widthPx: number;
  heightPx: number;
  paddingPx: number;
  fontFamily: string;
  fontSize: number;
  pageIndex: number;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (html === lastEmittedRef.current) return;
    el.innerHTML = isHtml(html) ? html : escapeText(html);
  }, [html]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = el.innerHTML;
    lastEmittedRef.current = next;
    onChange(next);
  };

  return (
    <div
      className="mx-auto rounded-sm bg-doc-paper shadow-doc"
      style={{
        width: widthPx,
        minHeight: heightPx,
        padding: paddingPx,
      }}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-page-index={pageIndex}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(e) => {
          if (e.ctrlKey && e.key === "Enter") {
            // Ctrl+Enter inside a page is treated as "insert page break"
            // by the parent — bubble via custom event.
            e.preventDefault();
            ref.current?.dispatchEvent(
              new CustomEvent("stack62:page-break", { bubbles: true }),
            );
          }
        }}
        onPaste={(e) => {
          const pastedHtml = e.clipboardData.getData("text/html");
          if (!pastedHtml) return;
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          emit();
        }}
        className="docs-surface min-h-full bg-transparent text-app outline-none"
        style={{
          fontFamily,
          fontSize,
          lineHeight: 1.6,
        }}
      />
    </div>
  );
}

function splitPages(text: string): string[] {
  if (!text) return [""];
  const re = /<hr\s+data-page-break="1"\s*\/?>/gi;
  const parts = text.split(re);
  return parts.length > 0 ? parts : [""];
}
function joinPages(pages: string[]): string {
  return pages.join(PAGE_BREAK_MARK);
}

function DocumentToolbar({
  layout,
  setLayout,
  onInsertBreak,
}: {
  layout: DocLayout;
  setLayout: (next: DocLayout) => void;
  onInsertBreak: () => void;
}) {
  // execCommand operates on whichever contentEditable currently owns the
  // selection — i.e. the page the user just clicked into. We just call it
  // directly; no need to thread a callback.
  const onExec = (command: string, value?: string) => {
    if (typeof document.execCommand !== "function") return;
    document.execCommand(command, false, value);
  };
  const setBlock = (tag: string) => onExec("formatBlock", `<${tag}>`);
  const insertLink = () => {
    const url = window.prompt("Link URL");
    if (url) onExec("createLink", url);
  };
  const insertImage = () => {
    const url = window.prompt("Image URL");
    if (url) onExec("insertImage", url);
  };
  const insertTable = () => {
    const rowsStr = window.prompt("Rows", "3");
    if (!rowsStr) return;
    const colsStr = window.prompt("Columns", "3");
    if (!colsStr) return;
    const rows = Math.max(1, Math.min(20, Number(rowsStr) || 3));
    const cols = Math.max(1, Math.min(20, Number(colsStr) || 3));
    let html = "<table>";
    for (let r = 0; r < rows; r += 1) {
      html += "<tr>";
      for (let c = 0; c < cols; c += 1) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += "</table><p></p>";
    onExec("insertHTML", html);
  };

  return (
    <div className="sticky top-0 z-20 border-b border-app bg-app-elevated text-app-muted shadow-sm">
      {/* Row 1 — Page layout */}
      <div className="flex flex-wrap items-center gap-1 border-b border-app-soft px-3 py-1.5 text-[11px]">
        <ToolbarSelect
          label="Page size"
          value={layout.pageSize}
          options={Object.entries(PAGE_SIZES).map(([k, v]) => ({
            value: k,
            label: v.name,
          }))}
          onPick={(v) =>
            setLayout({ ...layout, pageSize: v as keyof typeof PAGE_SIZES })
          }
        />
        <ToolbarSelect
          label="Orientation"
          value={layout.orientation}
          options={[
            { value: "portrait", label: "Portrait" },
            { value: "landscape", label: "Landscape" },
          ]}
          onPick={(v) =>
            setLayout({
              ...layout,
              orientation: v as "portrait" | "landscape",
            })
          }
        />
        <ToolbarSelect
          label="Margins"
          value={String(layout.marginIn)}
          options={[
            { value: "0.5", label: "Narrow (½\")" },
            { value: "1",   label: "Normal (1\")" },
            { value: "1.25", label: "Moderate (1.25\")" },
            { value: "1.5",  label: "Wide (1.5\")" },
          ]}
          onPick={(v) => setLayout({ ...layout, marginIn: Number(v) || 1 })}
        />
        <ToolbarDivider />
        <ToolbarSelect
          label="Font"
          value={layout.fontFamily}
          options={FONT_FAMILIES}
          onPick={(v) => setLayout({ ...layout, fontFamily: v })}
        />
        <ToolbarSelect
          label="Size"
          value={String(layout.fontSize)}
          options={FONT_SIZES.map((n) => ({ value: String(n), label: `${n}` }))}
          onPick={(v) => setLayout({ ...layout, fontSize: Number(v) || 14 })}
        />
      </div>

      {/* Row 2 — Formatting */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
        <ToolbarSelect
          label="Style"
          options={[
            { value: "p", label: "Normal" },
            { value: "h1", label: "Heading 1" },
            { value: "h2", label: "Heading 2" },
            { value: "h3", label: "Heading 3" },
          ]}
          onPick={(v) => setBlock(v)}
        />
        <ToolbarDivider />
        <DocsButton title="Bold (Ctrl+B)" onClick={() => onExec("bold")}>
          <Bold className="h-4 w-4" />
        </DocsButton>
        <DocsButton title="Italic (Ctrl+I)" onClick={() => onExec("italic")}>
          <Italic className="h-4 w-4" />
        </DocsButton>
        <DocsButton title="Underline (Ctrl+U)" onClick={() => onExec("underline")}>
          <span className="text-sm font-semibold underline">U</span>
        </DocsButton>
        <DocsButton title="Strikethrough" onClick={() => onExec("strikeThrough")}>
          <span className="text-sm font-semibold line-through">S</span>
        </DocsButton>
        <input
          type="color"
          title="Text color"
          onChange={(e) => onExec("foreColor", e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-app bg-app-elevated p-0.5"
        />
        <input
          type="color"
          title="Highlight color"
          onChange={(e) => onExec("hiliteColor", e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-app bg-app-elevated p-0.5"
        />
        <ToolbarDivider />
        <DocsButton title="Bulleted list" onClick={() => onExec("insertUnorderedList")}>
          <span className="text-sm">•≡</span>
        </DocsButton>
        <DocsButton title="Numbered list" onClick={() => onExec("insertOrderedList")}>
          <span className="text-sm">1.</span>
        </DocsButton>
        <DocsButton title="Quote" onClick={() => setBlock("blockquote")}>
          <span className="text-sm">"</span>
        </DocsButton>
        <DocsButton title="Indent" onClick={() => onExec("indent")}>
          <span className="text-xs">⇥</span>
        </DocsButton>
        <DocsButton title="Outdent" onClick={() => onExec("outdent")}>
          <span className="text-xs">⇤</span>
        </DocsButton>
        <ToolbarDivider />
        <DocsButton title="Align left" onClick={() => onExec("justifyLeft")}>
          <span className="text-[10px]">≡</span>
        </DocsButton>
        <DocsButton title="Align center" onClick={() => onExec("justifyCenter")}>
          <span className="text-[10px]">≡</span>
        </DocsButton>
        <DocsButton title="Align right" onClick={() => onExec("justifyRight")}>
          <span className="text-[10px]">≡</span>
        </DocsButton>
        <DocsButton title="Justify" onClick={() => onExec("justifyFull")}>
          <span className="text-[10px]">≡</span>
        </DocsButton>
        <ToolbarDivider />
        <DocsButton title="Insert link" onClick={insertLink}>
          <ExternalLink className="h-4 w-4" />
        </DocsButton>
        <DocsButton title="Insert image" onClick={insertImage}>
          <ImageIcon className="h-4 w-4" />
        </DocsButton>
        <DocsButton title="Insert table" onClick={insertTable}>
          <Table2 className="h-4 w-4" />
        </DocsButton>
        <DocsButton title="Insert page break (Ctrl+Enter)" onClick={onInsertBreak}>
          <span className="text-[10px]">⤓</span>
        </DocsButton>
        <ToolbarDivider />
        <DocsButton title="Undo" onClick={() => onExec("undo")}>
          <span className="text-sm">↶</span>
        </DocsButton>
        <DocsButton title="Redo" onClick={() => onExec("redo")}>
          <span className="text-sm">↷</span>
        </DocsButton>
        <DocsButton title="Clear formatting" onClick={() => onExec("removeFormat")}>
          <span className="text-xs">Tx</span>
        </DocsButton>
      </div>
    </div>
  );
}

function DocsButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded text-app-muted hover:bg-app-overlay hover:text-app"
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

function SheetSurface({
  text,
  onChange,
  zoom,
  workbook,
  activeSheetIndex,
  onSwitchSheet,
}: {
  text: string;
  onChange: (next: string) => void;
  zoom: number;
  workbook?: ParsedWorkbook | null;
  activeSheetIndex?: number;
  onSwitchSheet?: (idx: number) => void;
}) {
  const initial = useMemo(() => parseSheet(text), [text]);
  const [data, setData] = useState<string[][]>(initial.data);
  const [formats, setFormats] = useState<Record<string, CellFormat>>(
    initial.formats,
  );
  /**
   * Range selection. `anchor` is where the user clicked first;
   * `active` is where the selection currently ends. For a single-cell
   * click anchor === active. Row/column header clicks set the range
   * to span the whole row or column.
   */
  const [selection, setSelection] = useState<{
    anchorR: number;
    anchorC: number;
    activeR: number;
    activeC: number;
  }>({ anchorR: 0, anchorC: 0, activeR: 0, activeC: 0 });
  const [dragging, setDragging] = useState(false);

  const selected = useMemo(
    () => ({ r: selection.anchorR, c: selection.anchorC }),
    [selection.anchorR, selection.anchorC],
  );

  // Re-hydrate when external content changes.
  useEffect(() => {
    setData(initial.data);
    setFormats(initial.formats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Drag selection should end even if the mouse leaves the grid area.
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragging]);

  const columnCount = Math.max(10, ...data.map((row) => row.length));
  const rowCount = Math.max(20, data.length);

  const inSelection = (r: number, c: number) => {
    const r0 = Math.min(selection.anchorR, selection.activeR);
    const r1 = Math.max(selection.anchorR, selection.activeR);
    const c0 = Math.min(selection.anchorC, selection.activeC);
    const c1 = Math.max(selection.anchorC, selection.activeC);
    return r >= r0 && r <= r1 && c >= c0 && c <= c1;
  };
  const selectCell = (r: number, c: number, extend = false) => {
    if (extend) {
      setSelection((prev) => ({ ...prev, activeR: r, activeC: c }));
    } else {
      setSelection({ anchorR: r, anchorC: c, activeR: r, activeC: c });
    }
  };
  const selectRow = (r: number) => {
    setSelection({
      anchorR: r,
      anchorC: 0,
      activeR: r,
      activeC: Math.max(0, columnCount - 1),
    });
  };
  const selectColumn = (c: number) => {
    setSelection({
      anchorR: 0,
      anchorC: c,
      activeR: Math.max(0, rowCount - 1),
      activeC: c,
    });
  };
  const selectAll = () => {
    setSelection({
      anchorR: 0,
      anchorC: 0,
      activeR: Math.max(0, rowCount - 1),
      activeC: Math.max(0, columnCount - 1),
    });
  };
  const selectionRowSpan =
    Math.abs(selection.activeR - selection.anchorR) + 1;
  const selectionColSpan =
    Math.abs(selection.activeC - selection.anchorC) + 1;

  const flush = (nextData: string[][], nextFormats: Record<string, CellFormat>) => {
    setData(nextData);
    setFormats(nextFormats);
    onChange(serializeSheet(nextData, nextFormats));
  };

  const setCell = (r: number, c: number, value: string) => {
    const next = data.map((row) => [...row]);
    while (next.length <= r) next.push([]);
    while (next[r].length <= c) next[r].push("");
    next[r][c] = value;
    flush(next, formats);
  };

  const updateFormat = (patch: CellFormat) => {
    const key = cellKey(selected.r, selected.c);
    const nextFormats = { ...formats, [key]: { ...(formats[key] ?? {}), ...patch } };
    flush(data, nextFormats);
  };

  const addRow = () => flush([...data, []], formats);
  const addCol = () => {
    const next = data.map((row) => [...row, ""]);
    flush(next, formats);
  };

  const fmt = formats[cellKey(selected.r, selected.c)] ?? {};
  const valueOf = (r: number, c: number) =>
    (data[r] && data[r][c]) ?? "";

  return (
    <div className="flex h-full flex-col bg-doc-canvas">
      {/* Sheets-style toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-app bg-app-elevated px-3 py-1.5 text-[11px] text-app-muted">
        <span className="rounded border border-app bg-app px-2 py-0.5 font-mono text-app">
          {columnName(selected.c)}{selected.r + 1}
          {(selectionRowSpan > 1 || selectionColSpan > 1) && (
            <>
              {":"}
              {columnName(Math.max(selection.anchorC, selection.activeC))}
              {Math.max(selection.anchorR, selection.activeR) + 1}
              <span className="ml-1.5 text-app-faint">
                ({selectionRowSpan}×{selectionColSpan})
              </span>
            </>
          )}
        </span>
        <ToolbarDivider />
        <DocsButton
          title="Bold"
          onClick={() => updateFormat({ bold: !fmt.bold })}
        >
          <Bold className={`h-4 w-4 ${fmt.bold ? "text-cyan-400" : ""}`} />
        </DocsButton>
        <DocsButton
          title="Italic"
          onClick={() => updateFormat({ italic: !fmt.italic })}
        >
          <Italic className={`h-4 w-4 ${fmt.italic ? "text-cyan-400" : ""}`} />
        </DocsButton>
        <ToolbarDivider />
        <DocsButton
          title="Align left"
          onClick={() => updateFormat({ align: "left" })}
        >
          <span className={`text-[10px] ${fmt.align === "left" ? "text-cyan-400" : ""}`}>≡</span>
        </DocsButton>
        <DocsButton
          title="Align center"
          onClick={() => updateFormat({ align: "center" })}
        >
          <span className={`text-[10px] ${fmt.align === "center" ? "text-cyan-400" : ""}`}>≡</span>
        </DocsButton>
        <DocsButton
          title="Align right"
          onClick={() => updateFormat({ align: "right" })}
        >
          <span className={`text-[10px] ${fmt.align === "right" ? "text-cyan-400" : ""}`}>≡</span>
        </DocsButton>
        <ToolbarDivider />
        <input
          type="color"
          title="Cell fill"
          onChange={(e) => updateFormat({ bg: e.target.value })}
          className="h-7 w-7 cursor-pointer rounded border border-app bg-app-elevated p-0.5"
        />
        <DocsButton
          title="Clear formatting"
          onClick={() => {
            const key = cellKey(selected.r, selected.c);
            const next = { ...formats };
            delete next[key];
            flush(data, next);
          }}
        >
          <span className="text-xs">Tx</span>
        </DocsButton>
        <ToolbarDivider />
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
          title="Add row"
        >
          + Row
        </button>
        <button
          type="button"
          onClick={addCol}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
          title="Add column"
        >
          + Col
        </button>
      </div>

      {/* Formula bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-app bg-app-elevated px-3 py-1">
        <span className="text-[11px] font-mono text-app-faint">fx</span>
        <input
          value={valueOf(selected.r, selected.c)}
          onChange={(e) => setCell(selected.r, selected.c, e.target.value)}
          placeholder="Enter value or formula"
          className="min-w-0 flex-1 rounded border border-app bg-app px-2 py-0.5 font-mono text-[12px] text-app placeholder:text-app-faint focus:border-cyan-400/40 focus:outline-none"
        />
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div
          className="inline-block min-w-full rounded border border-app bg-doc-paper shadow-doc"
          style={{ zoom: `${zoom}%` }}
        >
          <div
            className="sticky top-0 z-10 grid border-b border-app bg-app-elevated text-[11px] font-medium text-app-muted"
            style={{
              gridTemplateColumns: `42px repeat(${columnCount}, minmax(110px, 1fr))`,
            }}
          >
            <button
              type="button"
              onClick={selectAll}
              title="Select all"
              className="border-r border-app p-2 hover:bg-app-hover"
            />
            {Array.from({ length: columnCount }).map((_, index) => {
              const colInRange =
                index >= Math.min(selection.anchorC, selection.activeC) &&
                index <= Math.max(selection.anchorC, selection.activeC);
              return (
                <button
                  type="button"
                  key={index}
                  onClick={() => selectColumn(index)}
                  title={`Select column ${columnName(index)}`}
                  className={`border-r border-app p-2 text-center hover:bg-cyan-500/10 ${
                    colInRange ? "bg-cyan-500/15 text-cyan-300" : ""
                  }`}
                >
                  {columnName(index)}
                </button>
              );
            })}
          </div>
          {Array.from({ length: rowCount }).map((_, rowIndex) => {
            const rowInRange =
              rowIndex >= Math.min(selection.anchorR, selection.activeR) &&
              rowIndex <= Math.max(selection.anchorR, selection.activeR);
            return (
              <div
                key={rowIndex}
                className="grid"
                style={{
                  gridTemplateColumns: `42px repeat(${columnCount}, minmax(110px, 1fr))`,
                }}
              >
                <button
                  type="button"
                  onClick={() => selectRow(rowIndex)}
                  title={`Select row ${rowIndex + 1}`}
                  className={`border-b border-r border-app bg-app-elevated p-2 text-center text-[11px] hover:bg-cyan-500/10 ${
                    rowInRange ? "bg-cyan-500/15 text-cyan-300" : "text-app-muted"
                  }`}
                >
                  {rowIndex + 1}
                </button>
                {Array.from({ length: columnCount }).map((_, colIndex) => {
                  const f = formats[cellKey(rowIndex, colIndex)] ?? {};
                  const isAnchor =
                    selection.anchorR === rowIndex &&
                    selection.anchorC === colIndex;
                  const isInRange = inSelection(rowIndex, colIndex);
                  return (
                    <input
                      key={colIndex}
                      value={valueOf(rowIndex, colIndex)}
                      onFocus={() => selectCell(rowIndex, colIndex)}
                      onMouseDown={(e) => {
                        selectCell(rowIndex, colIndex, e.shiftKey);
                        setDragging(true);
                      }}
                      onMouseEnter={() => {
                        if (dragging) selectCell(rowIndex, colIndex, true);
                      }}
                      onMouseUp={() => setDragging(false)}
                      onChange={(event) =>
                        setCell(rowIndex, colIndex, event.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          selectCell(
                            Math.min(rowCount - 1, rowIndex + 1),
                            colIndex,
                          );
                          (
                            (e.currentTarget.parentElement?.parentElement
                              ?.children[
                              rowIndex + 1
                            ]?.children[colIndex + 1] as HTMLInputElement) ??
                            null
                          )?.focus();
                        }
                      }}
                      style={{
                        fontWeight: f.bold ? 600 : 400,
                        fontStyle: f.italic ? "italic" : "normal",
                        textAlign: f.align ?? "left",
                        backgroundColor: f.bg ?? undefined,
                      }}
                      className={`border-b border-r border-app px-2 py-1.5 text-sm text-app outline-none focus:ring-1 focus:ring-cyan-400 ${
                        isAnchor
                          ? "ring-1 ring-cyan-400/50"
                          : isInRange
                            ? "bg-cyan-500/10"
                            : ""
                      }`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sheet tabs (xlsx workbook with multiple sheets) */}
      {workbook && workbook.sheets.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-app bg-app-elevated px-3 py-1">
          {workbook.sheets.map((sheet, idx) => (
            <button
              key={`${sheet.name}-${idx}`}
              type="button"
              onClick={() => onSwitchSheet?.(idx)}
              className={`shrink-0 rounded-t-md border-x border-t px-3 py-1 text-[11px] transition ${
                idx === (activeSheetIndex ?? 0)
                  ? "border-app bg-app text-app font-semibold"
                  : "border-transparent text-app-muted hover:bg-app-overlay"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SHEET_FORMAT_HEADER = "#stack62-sheet-formats:";
function parseSheet(text: string): SheetState {
  if (!text) return { data: [["", "", ""], ["", "", ""], ["", "", ""]], formats: {} };
  const lines = text.split(/\r?\n/);
  if (lines[0]?.startsWith(SHEET_FORMAT_HEADER)) {
    try {
      const formats = JSON.parse(lines[0].slice(SHEET_FORMAT_HEADER.length));
      return {
        data: parseCsv(lines.slice(1).join("\n")),
        formats: typeof formats === "object" && formats !== null ? formats : {},
      };
    } catch {
      /* fall through */
    }
  }
  return { data: parseCsv(text), formats: {} };
}
function serializeSheet(
  data: string[][],
  formats: Record<string, CellFormat>,
): string {
  const csv = toCsv(data);
  const hasFormats = Object.keys(formats).length > 0;
  if (!hasFormats) return csv;
  return `${SHEET_FORMAT_HEADER}${JSON.stringify(formats)}\n${csv}`;
}

/**
 * Slides surface — keeps the SlideDraft persistence shape (title + body)
 * but adds layout choices (title/content/two-column/quote/section), per-slide
 * background color, focused active-slide editing, and live thumbnails.
 */
type SlideLayout = "title" | "content" | "two_column" | "quote" | "section";
interface ExtendedSlide {
  title: string;
  body: string;
  layout?: SlideLayout;
  bg?: string;
}

const SLIDE_LAYOUT_LABEL: Record<SlideLayout, string> = {
  title: "Title slide",
  content: "Title + content",
  two_column: "Two columns",
  quote: "Quote",
  section: "Section header",
};

function SlidesSurface({
  text,
  onChange,
  zoom,
}: {
  text: string;
  onChange: (next: string) => void;
  zoom: number;
}) {
  const parsed = useMemo(() => parseExtendedSlides(text), [text]);
  const [active, setActive] = useState(0);
  const slides = parsed;

  const update = (next: ExtendedSlide[]) => {
    onChange(serializeExtendedSlides(next));
  };
  const setSlide = (index: number, patch: Partial<ExtendedSlide>) => {
    const next = slides.map((slide) => ({ ...slide }));
    next[index] = { ...next[index], ...patch };
    update(next);
  };
  const addSlide = () => {
    update([...slides, { title: "New slide", body: "", layout: "content" }]);
    setActive(slides.length);
  };
  const removeSlide = (index: number) => {
    if (slides.length <= 1) return;
    update(slides.filter((_, i) => i !== index));
    setActive(Math.max(0, index - 1));
  };
  const moveSlide = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
    setActive(target);
  };

  const current = slides[active] ?? slides[0];

  return (
    <div className="flex h-full flex-col bg-doc-canvas">
      {/* Slide toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-app bg-app-elevated px-3 py-1.5 text-[11px] text-app-muted">
        <ToolbarSelect
          label="Layout"
          value={current?.layout ?? "content"}
          options={(Object.keys(SLIDE_LAYOUT_LABEL) as SlideLayout[]).map(
            (l) => ({ value: l, label: SLIDE_LAYOUT_LABEL[l] }),
          )}
          onPick={(v) => setSlide(active, { layout: v as SlideLayout })}
        />
        <ToolbarDivider />
        <span className="text-[11px]">Background</span>
        <input
          type="color"
          value={current?.bg ?? "#ffffff"}
          onChange={(e) => setSlide(active, { bg: e.target.value })}
          className="h-7 w-7 cursor-pointer rounded border border-app bg-app-elevated p-0.5"
        />
        <ToolbarDivider />
        <button
          type="button"
          onClick={addSlide}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
        >
          + Slide
        </button>
        <button
          type="button"
          onClick={() => moveSlide(active, -1)}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
          title="Move slide up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveSlide(active, 1)}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
          title="Move slide down"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => removeSlide(active)}
          className="rounded border border-app bg-app-elevated px-2 py-0.5 hover:bg-app-overlay"
          title="Delete slide"
          disabled={slides.length <= 1}
        >
          <Trash2 className="inline h-3 w-3" />
        </button>
        <span className="ml-auto text-[11px] text-app-faint">
          Slide {active + 1} / {slides.length}
        </span>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-4">
        <aside className="flex w-44 shrink-0 flex-col gap-2 overflow-y-auto">
          {slides.map((slide, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActive(index)}
              className={`group block aspect-video w-full overflow-hidden rounded-md border text-left text-[10px] transition ${
                index === active
                  ? "border-cyan-400/60 ring-2 ring-cyan-400/30"
                  : "border-app hover:border-app-strong"
              }`}
              style={{ backgroundColor: slide.bg ?? "#ffffff" }}
            >
              <div className="h-full w-full p-2 text-slate-900">
                <p className="truncate font-semibold">{slide.title || `Slide ${index + 1}`}</p>
                <p className="mt-1 line-clamp-3 text-[9px] text-slate-600">
                  {slide.body}
                </p>
              </div>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1 overflow-auto">
          {current && (
            <SlideCanvas
              slide={current}
              zoom={zoom}
              onChange={(patch) => setSlide(active, patch)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SlideCanvas({
  slide,
  zoom,
  onChange,
}: {
  slide: ExtendedSlide;
  zoom: number;
  onChange: (patch: Partial<ExtendedSlide>) => void;
}) {
  const layout = slide.layout ?? "content";
  const width = 960 * (zoom / 100);
  const height = width * 0.5625;

  const surfaceClass =
    "mx-auto rounded-lg shadow-doc text-slate-900 overflow-hidden";
  const titleInput = (
    <input
      value={slide.title}
      onChange={(e) => onChange({ title: e.target.value })}
      placeholder="Slide title"
      className="w-full bg-transparent font-semibold outline-none placeholder:text-slate-400"
    />
  );
  const bodyArea = (
    <textarea
      value={slide.body}
      onChange={(e) => onChange({ body: e.target.value })}
      placeholder="Click to add content"
      className="w-full flex-1 resize-none bg-transparent leading-relaxed outline-none placeholder:text-slate-400"
    />
  );

  if (layout === "title") {
    return (
      <section
        className={`${surfaceClass} flex flex-col items-center justify-center p-16`}
        style={{ width, height, backgroundColor: slide.bg ?? "#ffffff" }}
      >
        <div className="w-full text-center" style={{ fontSize: 56, lineHeight: 1.1 }}>
          {titleInput}
        </div>
        <div className="mt-6 w-full text-center" style={{ fontSize: 22, color: "#475569" }}>
          {bodyArea}
        </div>
      </section>
    );
  }
  if (layout === "section") {
    return (
      <section
        className={`${surfaceClass} flex h-full flex-col justify-end p-16`}
        style={{ width, height, backgroundColor: slide.bg ?? "#0f172a" }}
      >
        <div className="text-white" style={{ fontSize: 22, opacity: 0.7 }}>
          {bodyArea}
        </div>
        <div className="mt-2 text-white" style={{ fontSize: 64, lineHeight: 1.1 }}>
          {titleInput}
        </div>
      </section>
    );
  }
  if (layout === "quote") {
    return (
      <section
        className={`${surfaceClass} flex flex-col items-center justify-center p-16 text-center`}
        style={{ width, height, backgroundColor: slide.bg ?? "#ffffff" }}
      >
        <div className="text-slate-900" style={{ fontSize: 40, lineHeight: 1.3, fontStyle: "italic" }}>
          {bodyArea}
        </div>
        <div className="mt-8 text-slate-600" style={{ fontSize: 18 }}>
          {titleInput}
        </div>
      </section>
    );
  }
  if (layout === "two_column") {
    const halves = slide.body.split(/\n--\n/);
    const left = halves[0] ?? "";
    const right = halves[1] ?? "";
    return (
      <section
        className={`${surfaceClass} flex flex-col p-12`}
        style={{ width, height, backgroundColor: slide.bg ?? "#ffffff" }}
      >
        <div style={{ fontSize: 36, lineHeight: 1.2 }}>{titleInput}</div>
        <div className="mt-6 grid flex-1 grid-cols-2 gap-6">
          <textarea
            value={left}
            onChange={(e) =>
              onChange({ body: `${e.target.value}\n--\n${right}` })
            }
            placeholder="Left column…"
            className="resize-none rounded bg-slate-50 p-3 text-slate-900 outline-none placeholder:text-slate-400"
            style={{ fontSize: 18, lineHeight: 1.5 }}
          />
          <textarea
            value={right}
            onChange={(e) =>
              onChange({ body: `${left}\n--\n${e.target.value}` })
            }
            placeholder="Right column…"
            className="resize-none rounded bg-slate-50 p-3 text-slate-900 outline-none placeholder:text-slate-400"
            style={{ fontSize: 18, lineHeight: 1.5 }}
          />
        </div>
      </section>
    );
  }
  // content
  return (
    <section
      className={`${surfaceClass} flex flex-col p-12`}
      style={{ width, height, backgroundColor: slide.bg ?? "#ffffff" }}
    >
      <div style={{ fontSize: 40, lineHeight: 1.15 }}>{titleInput}</div>
      <div className="mt-6 flex-1" style={{ fontSize: 20, lineHeight: 1.5 }}>
        {bodyArea}
      </div>
    </section>
  );
}

const SLIDE_EXT_HEADER = "#stack62-slides:";
function parseExtendedSlides(text: string): ExtendedSlide[] {
  if (!text) return [{ title: "Welcome", body: "", layout: "title" }];
  if (text.startsWith(SLIDE_EXT_HEADER)) {
    try {
      const data = JSON.parse(text.slice(SLIDE_EXT_HEADER.length));
      if (Array.isArray(data) && data.length > 0) return data as ExtendedSlide[];
    } catch {
      /* fall through */
    }
  }
  // Fall back to the plain SlideDraft parser used previously.
  const legacy = parseSlides(text);
  return legacy.map((s) => ({
    title: s.title,
    body: s.body,
    layout: "content" as SlideLayout,
  }));
}
function serializeExtendedSlides(slides: ExtendedSlide[]): string {
  return `${SLIDE_EXT_HEADER}${JSON.stringify(slides)}`;
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-app px-4 py-1.5 text-[11px] text-app-faint">
        {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "Loading PDF…"}
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-slate-200/40 p-4 dark:bg-slate-900/40"
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
