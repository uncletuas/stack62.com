import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  FolderPlus,
  Search,
  Share2,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  extractionApi,
  foldersApi,
  searchApi,
  type DocumentExtractionDto,
  type FolderDto,
  type SemanticHitDto,
} from "../../lib/dms-resources";
import { apiRequest } from "../../lib/api";
import { useAppContext } from "../../context/app-context";

/**
 * The Files surface — folder navigation + drag-and-drop upload + search.
 * When a folder is selected we show its files (existing /files endpoint
 * filtered by folderId). Selecting a file shows the OCR-extracted
 * fields panel on the right and a "Share" button.
 */
export function FilesExplorerEditor() {
  const { currentOrganization } = useAppContext();
  const orgId = currentOrganization?.id ?? "";

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
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {searchResults ? (
            <SearchResultsView
              hits={searchResults}
              onClose={() => setSearchResults(null)}
              onOpen={(fileId) => setSelectedFileId(fileId)}
            />
          ) : (
            <BrowseView
              folders={folders}
              files={files}
              loading={loading}
              onOpenFolder={openFolder}
              onSelectFile={setSelectedFileId}
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
  onSelectFile,
  selectedFileId,
}: {
  folders: FolderDto[];
  files: FileRow[];
  loading: boolean;
  onOpenFolder: (f: FolderDto) => void;
  onSelectFile: (id: string) => void;
  selectedFileId: string | null;
}) {
  if (loading && folders.length === 0 && files.length === 0) {
    return <div className="text-sm text-app-faint">Loading…</div>;
  }
  if (folders.length === 0 && files.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-app-faint">
        <div className="text-center">
          <p>This folder is empty.</p>
          <p className="mt-1 text-xs">
            Upload a file or create a sub-folder to get started.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {folders.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-app-faint">
            Folders
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => onOpenFolder(f)}
                className="flex items-center gap-2 rounded-md border border-app bg-app-surface px-3 py-2.5 text-left text-sm hover:bg-app-hover"
              >
                <FolderIcon />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{f.name}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-app-faint">
            Files
          </h3>
          <div className="overflow-hidden rounded-md border border-app">
            <table className="w-full text-sm">
              <thead className="bg-app-surface text-xs uppercase text-app-faint">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-left">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    onClick={() => onSelectFile(file.id)}
                    className={`cursor-pointer border-t border-app hover:bg-app-hover ${
                      selectedFileId === file.id ? "bg-app-hover" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium">{file.filename}</td>
                    <td className="px-3 py-2 text-app-faint">
                      {file.mimeType.split("/")[1] || "file"}
                    </td>
                    <td className="px-3 py-2 text-right text-app-faint">
                      {humanBytes(Number(file.size))}
                    </td>
                    <td className="px-3 py-2 text-app-faint">
                      {new Date(file.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
  onOpen: (fileId: string) => void;
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
            onClick={() => onOpen(h.fileId)}
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

  useEffect(() => {
    extractionApi.get(fileId).then(setExtraction).catch(() => setExtraction(null));
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
            disabled
            title="Share UI lands with file-sharing UX in batch 3"
            className="flex items-center justify-center gap-1.5 rounded-md border border-app px-3 py-2 text-app-faint"
          >
            <Share2 className="size-4" /> Share
          </button>
        </div>

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
