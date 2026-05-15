import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Copy,
  Download,
  FolderPlus,
  HardDrive,
  Info,
  Loader2,
  MoreVertical,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { localFolder } from "../../lib/local-folder";
import {
  extractionApi,
  fileSharingApi,
  fileVersionsApi,
  foldersApi,
  searchApi,
  type DocumentExtractionDto,
  type FileShareDto,
  type FileVersionDto,
  type FolderDto,
  type SemanticHitDto,
} from "../../lib/dms-resources";
import { apiRequest } from "../../lib/api";
import {
  deleteFile,
  fetchFileBlobUrl,
  fileDownloadUrl,
} from "../../lib/resources";
import { useAppContext } from "../../context/app-context";
import { useWorkspace } from "../workspace-context";
import { EmptyState } from "../../components/EmptyState";

/**
 * The Files surface — folder navigation + drag-and-drop upload + search.
 * When a folder is selected we show its files (existing /files endpoint
 * filtered by folderId). Selecting a file shows the OCR-extracted
 * fields panel on the right and a "Share" button.
 */
export function FilesExplorerEditor() {
  const { currentOrganization } = useAppContext();
  const { openTab } = useWorkspace();
  const orgId = currentOrganization?.id ?? "";

  /**
   * Open a file by id in a new editor tab. Distinct from the right-side
   * details panel — clicking a row opens the file, double-clicks the
   * "Details" icon to open the panel.
   */
  const openInTab = useCallback(
    (fileId: string, filename: string) => {
      openTab({ kind: "file", title: filename, refId: fileId });
    },
    [openTab],
  );

  const [breadcrumb, setBreadcrumb] = useState<FolderDto[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SemanticHitDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        foldersApi.list(orgId, parentId ?? undefined),
        apiRequest<FileRow[]>("/files", {
          query: { organizationId: orgId },
        }).then((rows) =>
          rows.filter((f) =>
            parentId
              ? f.folderId === parentId
              : f.folderId == null,
          ),
        ),
      ]);
      setFolders(foldersRes);
      setFiles(filesRes);
    } finally {
      setLoading(false);
    }
  }, [orgId, parentId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const openFolder = (folder: FolderDto) => {
    setBreadcrumb((prev) => [...prev, folder]);
    setParentId(folder.id);
    setSelectedFileId(null);
  };

  const goUp = (depth: number) => {
    if (depth < 0) {
      setBreadcrumb([]);
      setParentId(null);
    } else {
      const next = breadcrumb.slice(0, depth + 1);
      setBreadcrumb(next);
      setParentId(next[next.length - 1]?.id ?? null);
    }
    setSelectedFileId(null);
  };

  const onCreateFolder = async () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    await foldersApi.create({
      organizationId: orgId,
      parentId: parentId ?? undefined,
      name: name.trim(),
    });
    reload();
  };

  const onUpload = async (fileList: FileList | null) => {
    if (!fileList || !orgId) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("file", file);
        form.append("organizationId", orgId);
        form.append("scope", "document");
        if (parentId) form.append("folderId", parentId);
        await apiRequest("/files/upload", { method: "POST", body: form });
      }
      reload();
    } finally {
      setUploading(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim() || !orgId) return;
    const results = await searchApi.search(orgId, searchQuery.trim());
    setSearchResults(results);
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-app px-4 py-3">
          <Breadcrumb items={breadcrumb} onJump={goUp} />
          <div className="flex-1" />
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-app-faint" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
                if (e.key === "Escape") setSearchResults(null);
              }}
              placeholder="Search by meaning, not just name…"
              className="w-72 rounded-md border border-app bg-app pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            onClick={onCreateFolder}
            className="flex items-center gap-1.5 rounded-md border border-app px-3 py-1.5 text-sm hover:bg-app-hover"
          >
            <FolderPlus className="size-4" /> Folder
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90">
            <Upload className="size-4" /> {uploading ? "Uploading…" : "Upload"}
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => onUpload(e.target.files)}
            />
          </label>
          <LocalFolderButton />
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {searchResults ? (
            <SearchResultsView
              hits={searchResults}
              onClose={() => setSearchResults(null)}
              onOpen={(fileId, filename) => openInTab(fileId, filename)}
            />
          ) : (
            <BrowseView
              folders={folders}
              files={files}
              loading={loading}
              onOpenFolder={openFolder}
              onOpenFile={openInTab}
              onShowDetails={setSelectedFileId}
              onShareFile={(file) => {
                // Pre-fill the email composer with a short note + the
                // file's deep link. The user can edit and send via Resend.
                const subject = `Stack62: ${file.filename}`;
                const body = `I'm sharing "${file.filename}" with you via Stack62.\n\nOpen the file: ${window.location.origin}/app?file=${file.id}\n`;
                window.dispatchEvent(
                  new CustomEvent("stack62:open-email", {
                    detail: { subject, body },
                  }),
                );
              }}
              onDeleteFile={async (file) => {
                if (
                  !window.confirm(
                    `Delete "${file.filename}"? This action cannot be undone.`,
                  )
                )
                  return;
                try {
                  await deleteFile(file.id);
                  setFiles((prev) => prev.filter((f) => f.id !== file.id));
                  if (selectedFileId === file.id) setSelectedFileId(null);
                } catch (err) {
                  window.alert(
                    `Couldn't delete: ${err instanceof Error ? err.message : "unknown error"}`,
                  );
                }
              }}
              selectedFileId={selectedFileId}
            />
          )}
        </div>
      </div>

      {/* Right panel: file details + OCR fields */}
      {selectedFileId && (
        <FileDetailsPanel
          fileId={selectedFileId}
          onClose={() => setSelectedFileId(null)}
          onShared={reload}
        />
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

interface FileRow {
  id: string;
  filename: string;
  mimeType: string;
  size: string;
  folderId: string | null;
  scope: string;
  createdAt: string;
}

function Breadcrumb({
  items,
  onJump,
}: {
  items: FolderDto[];
  onJump: (depth: number) => void;
}) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      <button
        onClick={() => onJump(-1)}
        className="rounded px-2 py-1 hover:bg-app-hover"
      >
        Files
      </button>
      {items.map((folder, idx) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-3 text-app-faint" />
          <button
            onClick={() => onJump(idx)}
            className="rounded px-2 py-1 hover:bg-app-hover"
          >
            {folder.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function BrowseView({
  folders,
  files,
  loading,
  onOpenFolder,
  onOpenFile,
  onShowDetails,
  onShareFile,
  onDeleteFile,
  selectedFileId,
}: {
  folders: FolderDto[];
  files: FileRow[];
  loading: boolean;
  onOpenFolder: (f: FolderDto) => void;
  onOpenFile: (id: string, filename: string) => void;
  onShowDetails: (id: string) => void;
  onShareFile: (f: FileRow) => void;
  onDeleteFile: (f: FileRow) => void;
  selectedFileId: string | null;
}) {
  const [filter, setFilter] = useState<
    "all" | "documents" | "spreadsheets" | "images" | "pdfs"
  >("all");

  if (loading && folders.length === 0 && files.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2 text-sm text-app-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading files…
        </div>
      </div>
    );
  }
  if (folders.length === 0 && files.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={Upload}
          title="This folder is empty"
          description="Drop a file here, click Upload, or ask Coworker to fetch something for you."
        />
      </div>
    );
  }

  const filteredFiles = files.filter((f) => {
    if (filter === "all") return true;
    const ext = (f.filename.split(".").pop() || "").toLowerCase();
    const mt = f.mimeType.toLowerCase();
    if (filter === "documents") {
      return /docx?|rtf|txt|md|odt/.test(ext) || mt.includes("word") || mt.includes("text/");
    }
    if (filter === "spreadsheets") {
      return /xlsx?|csv|tsv|ods/.test(ext) || mt.includes("spreadsheet") || mt.includes("excel");
    }
    if (filter === "images") {
      return mt.startsWith("image/") || /png|jpe?g|gif|webp|svg|heic/.test(ext);
    }
    if (filter === "pdfs") {
      return mt === "application/pdf" || ext === "pdf";
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {folders.length > 0 && (
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Folders
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => onOpenFolder(f)}
                className="group flex items-center gap-2 rounded-lg border border-app bg-app-elevated px-3 py-3 text-left text-sm transition hover:border-accent hover:shadow-sm"
              >
                <FolderIcon />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{f.name}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          {/* Filter chips — Slack-style */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <h3 className="mr-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
              Files
            </h3>
            {(
              [
                { id: "all", label: "All" },
                { id: "documents", label: "Documents" },
                { id: "spreadsheets", label: "Spreadsheets" },
                { id: "images", label: "Images" },
                { id: "pdfs", label: "PDFs" },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                  filter === chip.id
                    ? "bg-accent text-accent-fg"
                    : "border border-app text-app-muted hover:bg-app-hover hover:text-app"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {filteredFiles.length === 0 ? (
            <p className="rounded-md border border-app bg-app-surface p-6 text-center text-sm text-app-faint">
              No {filter === "all" ? "files" : filter} match. Try a different filter.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredFiles.map((file) => (
                <FileTile
                  key={file.id}
                  file={file}
                  active={selectedFileId === file.id}
                  onOpen={() => onOpenFile(file.id, file.filename)}
                  onShowDetails={() => onShowDetails(file.id)}
                  onShare={() => onShareFile(file)}
                  onDelete={() => onDeleteFile(file)}
                />
              ))}
            </div>
          )}

        </section>
      )}
    </div>
  );
}

/**
 * File tile — Google Drive style: live image thumbnails for image
 * files, type-coded labels for everything else, hover reveals a
 * 3-dot actions menu (Open / Download / Share / Delete) and the
 * details button.
 *
 * Thumbnails for non-images (PDF first page, DOCX preview) are TODO —
 * they need server-side rendering (we'd add a /v1/files/:id/thumbnail
 * endpoint that renders + caches). For now those types fall back to
 * the colored label.
 */
function FileTile({
  file,
  active,
  onOpen,
  onShowDetails,
  onShare,
  onDelete,
}: {
  file: FileRow;
  active: boolean;
  onOpen: () => void;
  onShowDetails: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const ext = (file.filename.split(".").pop() || "").toLowerCase();
  const mt = file.mimeType.toLowerCase();
  const isImage =
    mt.startsWith("image/") || /png|jpe?g|gif|webp|svg/.test(ext);

  // Lazy-load the image preview only when the tile becomes visible.
  // Saves a download for every file in a long list. Once loaded the
  // blob URL is kept until the tile unmounts.
  const tileRef = useRef<HTMLDivElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const el = tileRef.current;
    if (!el) return;
    let cancelled = false;
    let revoked: string | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.disconnect();
          fetchFileBlobUrl(file.id)
            .then((url) => {
              if (cancelled) {
                URL.revokeObjectURL(url);
                return;
              }
              revoked = url;
              setThumbUrl(url);
            })
            .catch(() => undefined);
        });
      },
      { rootMargin: "150px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file.id, isImage]);

  const visual = (() => {
    if (isImage)
      return { bg: "bg-rose-100", text: "text-rose-600", label: "IMG" };
    if (mt === "application/pdf" || ext === "pdf")
      return { bg: "bg-amber-100", text: "text-amber-700", label: "PDF" };
    if (/docx?|rtf|txt|md|odt/.test(ext) || mt.includes("word"))
      return { bg: "bg-sky-100", text: "text-sky-700", label: "DOC" };
    if (
      /xlsx?|csv|tsv|ods/.test(ext) ||
      mt.includes("spreadsheet") ||
      mt.includes("excel")
    )
      return {
        bg: "bg-emerald-100",
        text: "text-emerald-700",
        label: "XLS",
      };
    if (/pptx?/.test(ext) || mt.includes("presentation"))
      return {
        bg: "bg-orange-100",
        text: "text-orange-700",
        label: "PPT",
      };
    return {
      bg: "bg-app-hover",
      text: "text-app-muted",
      label: ext.toUpperCase() || "FILE",
    };
  })();

  return (
    <div
      ref={tileRef}
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-app-elevated transition ${
        active
          ? "border-accent shadow-md"
          : "border-app hover:border-accent hover:shadow-sm"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col items-stretch p-0 text-left"
        title="Open file"
      >
        <div
          className={`relative flex aspect-[5/3] items-center justify-center overflow-hidden ${
            isImage && thumbUrl ? "bg-app-hover" : visual.bg
          }`}
        >
          {isImage && thumbUrl ? (
            <img
              src={thumbUrl}
              alt={file.filename}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span
              className={`text-2xl font-bold tracking-tight ${visual.text}`}
            >
              {visual.label}
            </span>
          )}
        </div>
        <div className="border-t border-app px-3 py-2">
          <p className="line-clamp-1 text-sm font-medium text-app">
            {file.filename}
          </p>
          <p className="mt-0.5 text-[11px] text-app-faint">
            {humanBytes(Number(file.size))} ·{" "}
            {new Date(file.createdAt).toLocaleDateString()}
          </p>
        </div>
      </button>

      {/* Hover overlay: details button + 3-dot menu */}
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowDetails();
          }}
          className="grid h-7 w-7 place-items-center rounded-md bg-app-elevated/95 text-app-muted shadow-sm backdrop-blur hover:text-app"
          title="Show details"
          aria-label="Show file details"
        >
          <Info className="size-3.5" />
        </button>
        <FileActionsMenu
          file={file}
          onOpen={onOpen}
          onShare={onShare}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/**
 * Per-file actions menu — opens on the ⋯ button. Closes on
 * outside-click and Escape.
 */
function FileActionsMenu({
  file,
  onOpen,
  onShare,
  onDelete,
}: {
  file: FileRow;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Array<{
    label: string;
    icon: typeof Info;
    onClick: () => void;
    danger?: boolean;
  }> = [
    {
      label: "Open",
      icon: Info,
      onClick: () => {
        setOpen(false);
        onOpen();
      },
    },
    {
      label: "Download",
      icon: Download,
      onClick: () => {
        setOpen(false);
        // Trigger a real download. fileDownloadUrl is auth-aware
        // via the apiRequest helper.
        const a = document.createElement("a");
        a.href = fileDownloadUrl(file.id);
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    },
    {
      label: "Share",
      icon: Share2,
      onClick: () => {
        setOpen(false);
        onShare();
      },
    },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      onClick: () => {
        setOpen(false);
        onDelete();
      },
    },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((cur) => !cur);
        }}
        className="grid h-7 w-7 place-items-center rounded-md bg-app-elevated/95 text-app-muted shadow-sm backdrop-blur hover:text-app"
        title="More actions"
        aria-label="File actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="size-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-app bg-app-elevated text-sm shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={item.onClick}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-app-hover ${
                item.danger ? "text-rose-600" : "text-app"
              }`}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResultsView({
  hits,
  onClose,
  onOpen,
}: {
  hits: SemanticHitDto[];
  onClose: () => void;
  onOpen: (fileId: string, filename: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Semantic search results</h3>
        <button
          onClick={onClose}
          className="text-xs text-app-faint hover:text-app"
        >
          Back to browse
        </button>
      </div>
      {hits.length === 0 ? (
        <div className="rounded-md border border-app p-6 text-center text-sm text-app-faint">
          No files match. Try a different phrasing — semantic search
          looks for meaning, not exact words.
        </div>
      ) : (
        hits.map((h) => (
          <button
            key={`${h.fileId}-${h.ordinal}`}
            onClick={() => onOpen(h.fileId, h.filename || h.fileId)}
            className="block w-full rounded-md border border-app bg-app-surface p-3 text-left hover:bg-app-hover"
          >
            <div className="flex items-center justify-between text-sm">
              <div className="font-medium">{h.filename || h.fileId}</div>
              <div className="text-xs text-app-faint">
                score {h.score.toFixed(2)}
              </div>
            </div>
            <p className="mt-1 text-xs text-app-faint">{h.text}</p>
          </button>
        ))
      )}
    </div>
  );
}

function FileDetailsPanel({
  fileId,
  onClose,
  onShared,
}: {
  fileId: string;
  onClose: () => void;
  onShared: () => void;
}) {
  const [extraction, setExtraction] = useState<DocumentExtractionDto | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [versions, setVersions] = useState<FileVersionDto[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);

  useEffect(() => {
    extractionApi.get(fileId).then(setExtraction).catch(() => setExtraction(null));
    fileVersionsApi.list(fileId).then(setVersions).catch(() => setVersions([]));
  }, [fileId]);

  const runExtraction = async () => {
    setExtracting(true);
    try {
      const next = await extractionApi.extract(fileId, { force: !!extraction });
      setExtraction(next);
      await searchApi.index(fileId).catch(() => undefined);
      onShared();
    } finally {
      setExtracting(false);
    }
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-app bg-app-surface">
      <div className="flex items-center justify-between border-b border-app px-4 py-3">
        <h3 className="text-sm font-semibold">File details</h3>
        <button
          onClick={onClose}
          className="text-xs text-app-faint hover:text-app"
        >
          Close
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4 text-sm">
        <div className="flex flex-col gap-2">
          <button
            onClick={runExtraction}
            disabled={extracting}
            className="flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-accent-fg hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="size-4" />
            {extracting
              ? "Extracting…"
              : extraction?.status === "completed"
                ? "Re-extract fields"
                : "Extract fields with AI"}
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-app px-3 py-2 hover:bg-app-hover"
          >
            <Share2 className="size-4" /> Share
          </button>
          {versions.length > 1 && (
            <button
              onClick={() => setVersionsOpen((v) => !v)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-app px-3 py-2 text-xs hover:bg-app-hover"
            >
              <Clock className="size-3.5" />
              {versionsOpen
                ? "Hide history"
                : `${versions.length} versions`}
            </button>
          )}
        </div>

        {versionsOpen && versions.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-xs uppercase text-app-faint">History</h4>
            <ol className="space-y-1.5 rounded-md border border-app bg-app p-2 text-xs">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className={v.isCurrent ? "font-semibold" : ""}>
                    v{v.version}
                    {v.isCurrent && (
                      <span className="ml-1 text-accent">(current)</span>
                    )}
                  </span>
                  <span className="text-app-faint">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {shareOpen && (
          <ShareModal fileId={fileId} onClose={() => setShareOpen(false)} />
        )}

        {extraction?.status === "completed" && extraction.extractedFields && (
          <section>
            <div className="mb-1 flex items-center justify-between text-xs uppercase text-app-faint">
              <span>{extraction.documentType}</span>
              {extraction.confidence != null && (
                <span>conf {Math.round(extraction.confidence * 100)}%</span>
              )}
            </div>
            <dl className="space-y-1 rounded-md border border-app bg-app p-3 text-xs">
              {Object.entries(extraction.extractedFields).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-app-faint">{k}</dt>
                  <dd className="text-right font-medium">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {extraction?.status === "failed" && (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-500">
            Extraction failed: {extraction.errorMessage}
          </div>
        )}
        {!extraction && (
          <p className="text-xs text-app-faint">
            No AI extraction yet. Click <strong>Extract fields with AI</strong>{" "}
            to pull structured data (vendor, date, totals, etc.) from this
            document.
          </p>
        )}
      </div>
    </aside>
  );
}

function ShareModal({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [permission, setPermission] = useState<FileShareDto["permission"]>("read");
  const [submitting, setSubmitting] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shares, setShares] = useState<FileShareDto[]>([]);

  useEffect(() => {
    fileSharingApi.list(fileId).then(setShares).catch(() => setShares([]));
  }, [fileId]);

  const sendShare = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await fileSharingApi.create(fileId, {
        targetEmail: email.trim(),
        permission,
        message: message.trim() || undefined,
      });
      setFeedback(
        result.emailed
          ? `Email sent to ${email.trim()}.`
          : `Shared. (Email service didn't deliver — they'll see it next time they sign in.)`,
      );
      setEmail("");
      setMessage("");
      const refreshed = await fileSharingApi.list(fileId);
      setShares(refreshed);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const createLink = async () => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await fileSharingApi.create(fileId, {
        permission,
        asPublicLink: true,
      });
      setLinkUrl(result.inviteUrl);
      const refreshed = await fileSharingApi.list(fileId);
      setShares(refreshed);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (shareId: string) => {
    await fileSharingApi.revoke(shareId);
    const refreshed = await fileSharingApi.list(fileId);
    setShares(refreshed);
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-app bg-app-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          <h3 className="text-sm font-semibold">Share file</h3>
          <button onClick={onClose} className="text-app-faint hover:text-app">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-4 text-sm">
          {/* Email share */}
          <section>
            <label className="mb-1 block text-xs font-semibold uppercase text-app-faint">
              Share with a person
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              type="email"
              className="w-full rounded-md border border-app bg-app px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional message…"
              rows={2}
              className="mt-2 w-full resize-none rounded-md border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-2 flex items-center gap-2">
              <select
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value as FileShareDto["permission"])
                }
                className="rounded-md border border-app bg-app px-2 py-1 text-xs"
              >
                <option value="read">Can view</option>
                <option value="comment">Can comment</option>
                <option value="write">Can edit</option>
              </select>
              <button
                onClick={sendShare}
                disabled={submitting || !email.trim()}
                className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </section>

          <div className="border-t border-app" />

          {/* Public link */}
          <section>
            <label className="mb-1 block text-xs font-semibold uppercase text-app-faint">
              Get a public link
            </label>
            {linkUrl ? (
              <div className="flex items-center gap-2 rounded-md border border-app bg-app px-2 py-1.5">
                <code className="flex-1 truncate text-xs">{linkUrl}</code>
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(linkUrl).then(() => {
                      setFeedback("Link copied to clipboard.");
                    })
                  }
                  className="rounded p-1 hover:bg-app-hover"
                >
                  <Copy className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={createLink}
                disabled={submitting}
                className="w-full rounded-md border border-app px-3 py-1.5 text-xs hover:bg-app-hover disabled:opacity-50"
              >
                Generate a link anyone with it can use
              </button>
            )}
          </section>

          {feedback && (
            <p className="text-xs text-app-faint">{feedback}</p>
          )}

          {shares.length > 0 && (
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase text-app-faint">
                Active shares ({shares.length})
              </h4>
              <ul className="space-y-1.5 rounded-md border border-app bg-app p-2 text-xs">
                {shares.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {s.shareToken
                        ? "Public link"
                        : s.targetEmail || s.targetUserId || "Unknown"}
                      <span className="ml-1 text-app-faint">
                        ({s.permission})
                      </span>
                    </span>
                    <button
                      onClick={() => revoke(s.id)}
                      className="text-app-faint hover:text-red-500"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "Connect a folder on your computer" — uses the browser's File System
 * Access API to read files from a local directory. The handle is
 * persisted in IndexedDB so we can re-prompt on next session rather
 * than starting from scratch.
 */
function LocalFolderButton() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entryCount, setEntryCount] = useState<number | null>(null);

  useEffect(() => {
    setSupported(localFolder.isSupported());
    void localFolder.getStoredHandle().then((handle) => {
      setConnected(!!handle);
    });
  }, []);

  if (supported === null) return null;

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Local folder access isn't supported in this browser. Use Chrome or Edge — or install Stack62 as a desktop app for full disk access."
        className="flex items-center gap-1.5 rounded-md border border-app px-3 py-1.5 text-sm text-app-faint"
      >
        <HardDrive className="size-4" /> Connect folder
      </button>
    );
  }

  const onClick = async () => {
    setBusy(true);
    try {
      let handle = await localFolder.getStoredHandle();
      if (!handle) {
        handle = await localFolder.connect();
      }
      if (!handle) return;
      setConnected(true);
      const entries = await localFolder.list(handle, 4, 5000);
      setEntryCount(entries.length);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Local folder access failed", err);
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    await localFolder.disconnect();
    setConnected(false);
    setEntryCount(null);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md border border-app px-3 py-1.5 text-sm hover:bg-app-hover"
        title={
          connected
            ? "Folder already connected — click to re-scan."
            : "Connect a folder on your computer so the Coworker can read files from it directly."
        }
      >
        <HardDrive className="size-4" />
        {busy
          ? "Scanning…"
          : connected
            ? entryCount != null
              ? `Local · ${entryCount} files`
              : "Local · connected"
            : "Connect folder"}
      </button>
      {connected && (
        <button
          type="button"
          onClick={onDisconnect}
          title="Disconnect the local folder"
          className="rounded-md border border-app px-2 py-1.5 text-app-faint hover:bg-app-hover"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="shrink-0 text-blue-500"
    >
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(n >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}
