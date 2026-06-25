import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  LayoutPanelTop,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
  Music,
  Play,
  Presentation,
  Printer,
  Save,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { appDialog } from "../../components/app-dialog";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../context/app-context";
import {
  fetchFileBlobUrl,
  fetchDocument,
  fetchFile,
  fetchFileContent,
  fileDownloadUrl,
  deleteFile,
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
type SurfaceKind = "document" | "sheet" | "slides" | "pdf" | "image" | "video" | "audio" | "text" | "unsupported";

const MEDIA_RE = /\.(mp4|webm|mov|m4v|ogv|mkv|mp3|wav|ogg|oga|m4a|aac|flac)$/i;

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
  /** Object URL for video/audio playback (revoked on unmount/tab change). */
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** The surface viewport we expand when the user hits "Fullscreen". */
  const surfaceRef = useRef<HTMLElement | null>(null);
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

  // Native Fullscreen API: expand just the surface viewport so media,
  // images, PDFs and decks fill the screen. We mirror the browser's own
  // state (Escape / system UI also toggle it) via the fullscreenchange event.
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(window.document.fullscreenElement === surfaceRef.current);
    window.document.addEventListener("fullscreenchange", onChange);
    return () =>
      window.document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    if (window.document.fullscreenElement) void window.document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  useEffect(() => {
    let revoked: string | null = null;
    if (!tab.refId || !currentOrganization) {
      setStored(null);
      setDocument(null);
      setEditableContent(null);
      setContent("");
      setImageUrl(null);
      setPdfUrl(null);
      setMediaUrl(null);
      setPresenting(false);
      return;
    }

    let live = true;
    setLoading(true);
    setSaving("idle");
    setDocument(null);
    setEditableContent(null);
    setImageUrl(null);
    setPdfUrl(null);
    setMediaUrl(null);
    setPresenting(false);
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

    void fetchFile(tab.refId)
      .then(async (file) => {
        if (!live) return;
        setStored(file);
        if (!file) return;

        if (file.mimeType.startsWith("image/")) {
          try {
            const url = await fetchFileBlobUrl(file.id);
            revoked = url;
            if (live) setImageUrl(url);
          } catch (err) {
            appendRunLog({
              level: "error",
              text: `Couldn't load image ${file.filename}: ${(err as Error).message}`,
              source: "files",
            });
          }
          return;
        }

        if (file.mimeType === "application/pdf" || /\.pdf$/i.test(file.filename)) {
          try {
            const url = await fetchFileBlobUrl(file.id);
            revoked = url;
            if (live) setPdfUrl(url);
          } catch (err) {
            appendRunLog({
              level: "error",
              text: `Couldn't load PDF ${file.filename}: ${(err as Error).message}`,
              source: "files",
            });
          }
          return;
        }

        if (
          file.mimeType.startsWith("video/") ||
          file.mimeType.startsWith("audio/") ||
          MEDIA_RE.test(file.filename)
        ) {
          try {
            const url = await fetchFileBlobUrl(file.id);
            revoked = url;
            if (live) setMediaUrl(url);
          } catch (err) {
            appendRunLog({
              level: "error",
              text: `Couldn't load media ${file.filename}: ${(err as Error).message}`,
              source: "files",
            });
          }
          return;
        }

        // Real spreadsheet path: parse xlsx/xls binaries client-side with
        // SheetJS so we get every sheet, every row, types intact.
        if (/\.(xlsx|xls)$/i.test(file.filename)) {
          let url: string | null = null;
          try {
            url = await fetchFileBlobUrl(file.id);
            revoked = url;
          } catch (err) {
            appendRunLog({
              level: "error",
              text: `Couldn't download spreadsheet ${file.filename}: ${(err as Error).message}`,
              source: "files",
            });
          }
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
          // Don't swallow errors here — a failed extraction is the
          // #1 cause of "I uploaded a doc and it won't open". The
          // run log shows the actual reason instead of a blank
          // editor.
          try {
            const doc = await fetchFileContent(file.id);
            if (live && doc) {
              setEditableContent(doc);
              setContent(doc.text);
              setSaving("saved");
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            appendRunLog({
              level: "error",
              text: `Couldn't read ${file.filename}: ${msg}`,
              source: "files",
            });
            // Set an empty editable shell so the user still gets the
            // header + can re-upload or download. Better than a blank
            // canvas with no UI affordance.
            if (live) {
              setEditableContent({
                fileId: file.id,
                filename: file.filename,
                mimeType: file.mimeType,
                editable: false,
                format: "text",
                text: `[Couldn't read this file: ${msg}]\n\nTry: downloading it, re-uploading, or asking the Coworker to extract its contents.`,
              });
              setContent(
                `[Couldn't read this file: ${msg}]\n\nTry: downloading it, re-uploading, or asking the Coworker to extract its contents.`,
              );
            }
          }
        }
      })
      .catch((err) => {
        if (!live) return;
        setStored(null);
        appendRunLog({
          level: "error",
          text: `Couldn't open file: ${(err as Error).message}`,
          source: "files",
        });
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
      const docId = document.id;
      // Name the document after its first line of text, the way most
      // word processors title an untitled file. We keep tracking the
      // first line until the user renames the doc to something that no
      // longer matches a default/untitled placeholder.
      const derivedTitle = deriveTitleFromContent(next);
      const currentTitle = document.title ?? "";
      const titleIsAuto =
        !currentTitle.trim() ||
        /^untitled/i.test(currentTitle) ||
        currentTitle === deriveTitleFromContent(content);
      const nextTitle =
        derivedTitle && titleIsAuto && derivedTitle !== currentTitle
          ? derivedTitle
          : undefined;
      saveTimer.current = window.setTimeout(() => {
        void updateDocument(docId, {
          content: next,
          ...(nextTitle ? { title: nextTitle } : {}),
          changeSummary: "Autosaved from Explorer",
        })
          .then((saved) => {
            setDocument(saved);
            setSaving("saved");
            if (nextTitle) {
              updateTab(tab.id, { title: saved.title });
              // Refresh the sidebar/explorer so the new name shows there too.
              window.dispatchEvent(new CustomEvent("stack62:files-changed"));
            }
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

  // Open / play the media (or PDF) in a new browser tab. Reuses the blob
  // we've already loaded so playback starts instantly; falls back to the
  // download URL if the blob isn't ready yet.
  const openMedia = useCallback(() => {
    const url = mediaUrl ?? imageUrl ?? pdfUrl;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (stored?.id) {
      window.open(fileDownloadUrl(stored.id), "_blank", "noopener,noreferrer");
    }
  }, [mediaUrl, imageUrl, pdfUrl, stored?.id]);

  if (!tab.refId) return <EmptyFileState inputRef={inputRef} onUpload={onUpload} draft={fileDrafts[tab.id]} />;

  return (
    <div className={`flex h-full flex-col ${surface === "sheet" ? "bg-white" : "bg-app text-app"}`}>
      {surface !== "document" && surface !== "sheet" && (
        <FileWorkbenchHeader
          file={stored}
          title={displayName}
          saving={saving}
          surface={surface}
          zoom={zoom}
          setZoom={setZoom}
          onDelete={removeFile}
          onOpenGoogle={openGoogle}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          onPresent={() => setPresenting(true)}
          onOpenMedia={openMedia}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <main
          ref={surfaceRef}
          className={`min-w-0 flex-1 overflow-auto ${surface === "sheet" ? "" : "bg-[#111827]"}`}
        >
          {loading ? (
            <div className="grid h-full place-items-center text-app-faint">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !stored && !document ? (
            <EmptyMessage text="Item not available." />
          ) : surface === "image" && imageUrl ? (
            <ImageSurface filename={stored.filename} url={imageUrl} zoom={zoom} />
          ) : surface === "video" && mediaUrl ? (
            <VideoSurface filename={stored.filename} url={mediaUrl} />
          ) : surface === "audio" && mediaUrl ? (
            <AudioSurface filename={stored.filename} url={mediaUrl} />
          ) : surface === "pdf" && pdfUrl ? (
            <PdfSurface filename={stored.filename} url={pdfUrl} />
          ) : surface === "sheet" ? (
            <SheetEditor text={content} onChange={queueSave} title={displayName} />
          ) : surface === "slides" ? (
            <SlidesEditor text={content} onChange={queueSave} title={displayName} />
          ) : surface === "document" ? (
            <DocsEditor
              text={content}
              onChange={queueSave}
              zoom={zoom}
              documentId={document?.id ?? null}
              title={displayName}
            />
          ) : surface === "text" ? (
            <TextSurface text={content} onChange={queueSave} />
          ) : (
            <EmptyMessage text="Preview unavailable for this file type. Download it or ask the coworker to convert it." />
          )}
        </main>
      </div>

      {presenting && (surface === "slides" || surface === "pdf") && (
        <PresentOverlay
          surface={surface}
          content={content}
          url={pdfUrl}
          filename={displayName}
          onClose={() => setPresenting(false)}
        />
      )}
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
  isFullscreen,
  onToggleFullscreen,
  onPresent,
  onOpenMedia,
}: {
  file: StoredFile | null;
  title: string;
  saving: SavingState;
  surface: SurfaceKind;
  zoom: number;
  setZoom: (zoom: number) => void;
  onDelete: () => void;
  onOpenGoogle: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onPresent: () => void;
  onOpenMedia: () => void;
}) {
  const Icon =
    surface === "sheet"
      ? Table2
      : surface === "slides"
        ? Presentation
        : surface === "image"
          ? ImageIcon
          : surface === "video"
            ? Film
            : surface === "audio"
              ? Music
              : FileText;
  const canFullscreen = ["image", "video", "audio", "pdf", "slides"].includes(
    surface,
  );
  const canPresent = surface === "slides" || surface === "pdf";
  const isMedia = ["image", "video", "audio", "pdf"].includes(surface);
  const canGoogle = ["document", "sheet", "slides", "text"].includes(surface);

  // Every discrete action a user can take on the open file, collapsed into a
  // single dropdown instead of a row of toolbar buttons.
  const actions: FileAction[] = [];
  if (isMedia) {
    actions.push({
      label:
        surface === "video" || surface === "audio"
          ? "Open / play in new tab"
          : "Open in new tab",
      icon: surface === "image" || surface === "pdf" ? ExternalLink : Play,
      onSelect: onOpenMedia,
    });
  }
  if (canPresent) {
    actions.push({ label: "Present", icon: Play, onSelect: onPresent });
  }
  if (canFullscreen) {
    actions.push({
      label: isFullscreen ? "Exit fullscreen" : "Fullscreen",
      icon: isFullscreen ? Minimize2 : Maximize2,
      onSelect: onToggleFullscreen,
    });
  }
  if (canGoogle) {
    actions.push({
      label: "Open in Google",
      icon: ExternalLink,
      onSelect: onOpenGoogle,
    });
  }
  actions.push({
    label: "Print",
    icon: Printer,
    onSelect: () => window.print(),
  });
  if (file?.id) {
    actions.push({
      label: "Download",
      icon: Download,
      href: fileDownloadUrl(file.id),
    });
    actions.push({
      label: "Delete",
      icon: Trash2,
      onSelect: onDelete,
      danger: true,
      separatorAbove: true,
    });
  }

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
        {surface === "image" && (
          <>
            <label className="text-[11px] text-app-faint">Zoom</label>
            <input
              type="range"
              min={25}
              max={300}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-24 accent-cyan-400"
            />
            <span className="w-9 text-right text-[11px] text-app-subtle">{zoom}%</span>
          </>
        )}
        <FileActionsMenu actions={actions} />
      </div>
    </header>
  );
}

interface FileAction {
  label: string;
  icon: typeof Save;
  onSelect?: () => void;
  /** When set, the item is an anchor (e.g. Download) instead of a button. */
  href?: string;
  danger?: boolean;
  separatorAbove?: boolean;
}

/**
 * Single "Actions" dropdown for the file workbench. Replaces the old row of
 * toolbar buttons so the header stays clean and the available actions read as
 * a list. Closes on outside-click or after an item is chosen.
 */
function FileActionsMenu({ actions }: { actions: FileAction[] }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ml-1 inline-flex h-8 items-center gap-1 rounded border border-app bg-app-surface px-2 text-xs text-app-muted hover:border-app-strong hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
        Actions
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-lg border border-app bg-app-elevated shadow-xl"
        >
          {actions.map((action, idx) => {
            const ItemIcon = action.icon;
            const cls = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
              action.separatorAbove && idx > 0 ? "border-t border-app" : ""
            } ${
              action.danger
                ? "text-rose-300 hover:bg-rose-950/30"
                : "text-app hover:bg-app-hover"
            }`;
            if (action.href) {
              return (
                <a
                  key={action.label}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className={cls}
                >
                  <ItemIcon className="h-3.5 w-3.5" />
                  {action.label}
                </a>
              );
            }
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.onSelect?.();
                }}
                className={cls}
              >
                <ItemIcon className="h-3.5 w-3.5" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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

function ImageSurface({
  filename,
  url,
  zoom,
}: {
  filename: string;
  url: string;
  zoom: number;
}) {
  // The header's zoom slider drives the picture size. At 100% it fills the
  // viewport width; above that the container scrolls so the user can pan
  // around a zoomed-in image, like any image viewer.
  return (
    <div className="h-full w-full overflow-auto p-6">
      <div className="flex min-h-full min-w-full items-center justify-center">
        <img
          src={url}
          alt={filename}
          style={{ width: `${zoom}%` }}
          className="shadow-2xl"
        />
      </div>
    </div>
  );
}

function VideoSurface({ filename, url }: { filename: string; url: string }) {
  return (
    <div className="grid h-full place-items-center bg-black p-4">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="max-h-full max-w-full rounded shadow-2xl"
        title={filename}
      >
        Your browser can&apos;t play this video.{" "}
        <a href={url} download={filename} className="underline">
          Download
        </a>{" "}
        it instead.
      </video>
    </div>
  );
}

function AudioSurface({ filename, url }: { filename: string; url: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="w-full max-w-xl rounded-2xl border border-app bg-app-surface p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full bg-cyan-500/15 text-cyan-300">
          <Music className="h-9 w-9" />
        </div>
        <div className="mb-5 truncate text-sm font-medium text-app" title={filename}>
          {filename}
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={url} controls autoPlay className="w-full">
          Your browser can&apos;t play this audio file.
        </audio>
      </div>
    </div>
  );
}

/**
 * Fullscreen slideshow for decks and PDFs. Slides come from the same
 * `parseSlides` the SlidesEditor uses; PDF pages render one-at-a-time via
 * pdf.js sized to fit the screen. Arrow keys / Space / click-zones advance,
 * Escape exits. We also request the browser Fullscreen API for a true
 * edge-to-edge present, and mirror its teardown on unmount.
 */
function PresentOverlay({
  surface,
  content,
  url,
  filename,
  onClose,
}: {
  surface: "slides" | "pdf";
  content: string;
  url: string | null;
  filename: string;
  onClose: () => void;
}) {
  const slides = useMemo(
    () => (surface === "slides" ? parseSlides(content) : []),
    [surface, content],
  );
  const [index, setIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<{ getPage: (n: number) => Promise<unknown>; numPages: number; destroy: () => void } | null>(null);

  const total = surface === "slides" ? Math.max(1, slides.length) : Math.max(1, pageCount);
  const next = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Browser fullscreen + keyboard navigation.
  useEffect(() => {
    void rootRef.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (window.document.fullscreenElement) void window.document.exitFullscreen().catch(() => {});
    };
  }, [next, prev, onClose]);

  // PDF: load the document once.
  useEffect(() => {
    if (surface !== "pdf" || !url) return;
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import(
          "pdfjs-dist/build/pdf.worker.mjs?url"
        )) as { default: string };
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc as unknown as typeof docRef.current;
        setPageCount(doc.numPages);
      } catch {
        /* ignore — overlay just shows an empty stage */
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [surface, url]);

  // PDF: render the current page to fit the viewport.
  useEffect(() => {
    if (surface !== "pdf") return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    void (async () => {
      const page = (await doc.getPage(index + 1)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void> };
      };
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(
        0.2,
        Math.min(window.innerWidth / base.width, (window.innerHeight - 96) / base.height),
      );
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, index, pageCount]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-[120] flex flex-col bg-black text-white">
      <div className="flex items-center gap-3 px-5 py-2 text-xs text-white/60">
        <span className="truncate">{filename}</span>
        <span className="ml-auto tabular-nums">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Exit (Esc)"
          className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 py-6">
        {surface === "slides" ? (
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-8 text-5xl font-bold leading-tight">
              {slides[index]?.title}
            </h1>
            <div className="whitespace-pre-wrap text-2xl leading-relaxed text-white/85">
              {slides[index]?.body}
            </div>
          </div>
        ) : (
          <canvas ref={canvasRef} className="max-h-full max-w-full bg-white shadow-2xl" />
        )}

        {/* Click zones for next/prev. */}
        <button
          type="button"
          onClick={prev}
          aria-label="Previous"
          className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize focus:outline-none"
        />
        <button
          type="button"
          onClick={next}
          aria-label="Next"
          className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-center gap-4 pb-5">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={next}
          disabled={index >= total - 1}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
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
  if (file.mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(lower)) return "video";
  if (file.mimeType.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i.test(lower)) return "audio";
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

/**
 * Derive a document title from the first non-empty line of its content.
 * The content may be HTML (TipTap output) or plain text; either way we
 * pull the first visible line, collapse whitespace, and cap the length so
 * the tab/sidebar stay readable. Returns "" when there's nothing usable
 * yet (so the caller can leave the existing title alone).
 */
function deriveTitleFromContent(raw: string): string {
  if (!raw) return "";
  let text = raw;
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    // Turn block boundaries into newlines before stripping tags so the
    // "first line" matches the first paragraph/heading, not the whole doc.
    text = raw
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    // Decode the handful of entities our serializer emits.
    text = text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80).trim()}…` : collapsed;
}
