import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ClipboardCopy,
  Copy,
  Download,
  Edit3,
  FileText,
  FolderPlus,
  FolderInput,
  HardDrive,
  Image as ImageIcon,
  Video,
  Music,
  File,
  Info,
  Loader2,
  MoreVertical,
  Move,
  Plus,
  Presentation,
  Scissors,
  Search,
  Share2,
  Sheet as SheetIcon,
  Sparkles,
  Square,
  SquareCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { appDialog } from "../../components/app-dialog";
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
  bulkDeleteFiles,
  bulkMoveFiles,
  copyFile,
  createWorkspaceDoc,
  deleteFile,
  fetchFileBlobUrl,
  fileDownloadUrl,
  updateFile,
  type WorkspaceDocKind,
} from "../../lib/resources";
import { useAppContext } from "../../context/app-context";
import { useWorkspace } from "../workspace-context";
import { EmptyState } from "../../components/EmptyState";

interface FileRow {
  id: string;
  filename: string;
  mimeType: string;
  size: string;
  folderId: string | null;
  scope: string;
  createdAt: string;
}

interface ClipboardState {
  /** "cut" leaves the source rows visible but dimmed; on paste they
   *  move. "copy" duplicates on paste. */
  mode: "cut" | "copy";
  fileIds: string[];
}

/**
 * Files explorer — Google Drive-style ergonomics:
 *
 *   - Click selects, Cmd/Ctrl-click toggles, Shift-click selects range
 *   - Drag-select with a rubber-band (TODO: not yet — list is grid)
 *   - Delete / Backspace: bulk delete with confirm
 *   - F2 / Enter on focused row: rename
 *   - Cmd/Ctrl-X / -C / -V: cut / copy / paste (move/duplicate)
 *   - Drag a file (or several) onto a folder tile to move them
 *   - Bulk action toolbar floats in when selection is non-empty
 *   - Right-click context menu on tiles
 *   - All confirms/prompts go through the in-app dialog system, no
 *     browser-native popups
 */
export function FilesExplorerEditor() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { openTab, appendRunLog } = useWorkspace();
  const orgId = currentOrganization?.id ?? "";
  const workspaceId = currentWorkspace?.id ?? "";

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
  const [detailsFileId, setDetailsFileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SemanticHitDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    fileId: string;
  } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showNewSubmenu, setShowNewSubmenu] = useState(false);
  const [creating, setCreating] = useState<WorkspaceDocKind | null>(null);

  // Create a new workspace document/sheet/slides via the
  // workspace-actions pipeline, then open it in a new tab. The
  // Coworker can then drive it via office.dispatch_action; the
  // user can edit it directly too. Same shared state.
  const onCreateWorkspaceDoc = async (
    kind: WorkspaceDocKind,
    defaultTitle: string,
  ) => {
    if (!orgId || !workspaceId) {
      await appDialog.alert({
        title: "Workspace required",
        description:
          "Select an organization and workspace before creating a doc.",
        tone: "destructive",
      });
      return;
    }
    setShowOptionsMenu(false);
    const title = await appDialog.prompt({
      title: `New ${kind === "document" ? "document" : kind === "sheet" ? "spreadsheet" : "presentation"}`,
      description: "Give it a name. You can rename later.",
      placeholder: defaultTitle,
      initialValue: defaultTitle,
      confirmLabel: "Create",
    });
    if (!title?.trim()) return;
    setCreating(kind);
    try {
      const result = await createWorkspaceDoc({
        organizationId: orgId,
        workspaceId,
        kind,
        title: title.trim(),
      });
      openTab({
        kind: "workspace-doc",
        title: title.trim(),
        refId: result.action.docId,
      });
      appendRunLog({
        level: "ok",
        text: `Created ${kind}: ${title.trim()}`,
        source: "files",
      });
    } catch (err) {
      await appDialog.alert({
        title: "Couldn't create",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setCreating(null);
    }
  };

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
            parentId ? f.folderId === parentId : f.folderId == null,
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
    void reload();
  }, [reload]);

  // Refresh when something signals the editor (after coworker action,
  // after a fresh upload elsewhere). Also poll on tab focus so files
  // that arrived from another tab still appear here.
  useEffect(() => {
    const handler = () => void reload();
    window.addEventListener("stack62:editor-refresh", handler);
    window.addEventListener("stack62:files-changed", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("stack62:editor-refresh", handler);
      window.removeEventListener("stack62:files-changed", handler);
      window.removeEventListener("focus", handler);
    };
  }, [reload]);

  // Clear selection on navigation.
  useEffect(() => {
    setSelection(new Set());
    setLastSelectedId(null);
    setDetailsFileId(null);
  }, [parentId]);

  const openFolder = (folder: FolderDto) => {
    setBreadcrumb((prev) => [...prev, folder]);
    setParentId(folder.id);
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
  };

  const onCreateFolder = async () => {
    const name = await appDialog.prompt({
      title: "New folder",
      placeholder: "Folder name",
      confirmLabel: "Create",
      validate: (v) =>
        !v.trim()
          ? "Name is required."
          : /[\\/]/.test(v)
            ? "No / or \\ allowed."
            : null,
    });
    if (!name?.trim()) return;
    await foldersApi.create({
      organizationId: orgId,
      parentId: parentId ?? undefined,
      name: name.trim(),
    });
    void reload();
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
        try {
          await apiRequest("/files/upload", { method: "POST", body: form });
        } catch (err) {
          await appDialog.alert({
            title: `Upload failed: ${file.name}`,
            description: err instanceof Error ? err.message : "Unknown error.",
            tone: "destructive",
          });
        }
      }
      await reload();
      window.dispatchEvent(new CustomEvent("stack62:files-changed"));
    } finally {
      setUploading(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim() || !orgId) return;
    const results = await searchApi.search(orgId, searchQuery.trim());
    setSearchResults(results);
  };

  // ── Selection helpers ────────────────────────────────────────────
  const selectOne = useCallback(
    (id: string, ev: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
      const additive = !!(ev.ctrlKey || ev.metaKey);
      const ranged = !!ev.shiftKey;
      setSelection((prev) => {
        if (ranged && lastSelectedId) {
          const ids = files.map((f) => f.id);
          const a = ids.indexOf(lastSelectedId);
          const b = ids.indexOf(id);
          if (a === -1 || b === -1) {
            const next = new Set(prev);
            next.add(id);
            return next;
          }
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = ids.slice(lo, hi + 1);
          const next = additive ? new Set(prev) : new Set<string>();
          range.forEach((x) => next.add(x));
          return next;
        }
        if (additive) {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        return new Set([id]);
      });
      setLastSelectedId(id);
    },
    [files, lastSelectedId],
  );

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setLastSelectedId(null);
  }, []);

  const selectAll = useCallback(() => {
    setSelection(new Set(files.map((f) => f.id)));
  }, [files]);

  // ── Bulk actions ─────────────────────────────────────────────────
  const selectedIds = useMemo(() => Array.from(selection), [selection]);
  const selectedFiles = useMemo(
    () => files.filter((f) => selection.has(f.id)),
    [files, selection],
  );

  const doDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const ok = await appDialog.confirm({
        title: ids.length === 1 ? "Delete file?" : `Delete ${ids.length} files?`,
        description:
          ids.length === 1
            ? `"${files.find((f) => f.id === ids[0])?.filename}" will be moved to the recycle. This cannot be undone.`
            : "These files will be moved to the recycle. This cannot be undone.",
        destructive: true,
        confirmLabel: "Delete",
      });
      if (!ok) return;
      try {
        if (ids.length === 1) await deleteFile(ids[0]);
        else await bulkDeleteFiles(ids);
        setFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
        setSelection((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        if (detailsFileId && ids.includes(detailsFileId)) setDetailsFileId(null);
      } catch (err) {
        await appDialog.alert({
          title: "Delete failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "destructive",
        });
      }
    },
    [files, detailsFileId],
  );

  const doRename = useCallback(
    async (fileId: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      const next = await appDialog.prompt({
        title: "Rename file",
        initialValue: file.filename,
        placeholder: file.filename,
        confirmLabel: "Rename",
        validate: (v) =>
          !v.trim()
            ? "Name is required."
            : /[\\/]/.test(v)
              ? "No / or \\ allowed."
              : null,
      });
      if (!next || next === file.filename) return;
      try {
        const updated = await updateFile(fileId, { filename: next.trim() });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileId ? { ...f, filename: updated.filename } : f,
          ),
        );
      } catch (err) {
        await appDialog.alert({
          title: "Rename failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "destructive",
        });
      }
    },
    [files],
  );

  const doCopyLink = useCallback(async (file: FileRow) => {
    const url = `${window.location.origin}/app?file=${file.id}`;
    try {
      await navigator.clipboard.writeText(url);
      await appDialog.alert({
        title: "Link copied",
        description: url,
        tone: "success",
      });
    } catch {
      await appDialog.alert({
        title: "Link",
        description: url,
      });
    }
  }, []);

  const doShare = useCallback((file: FileRow) => {
    const subject = `Stack62: ${file.filename}`;
    const body = `I'm sharing "${file.filename}" with you via Stack62.\n\nOpen the file: ${window.location.origin}/app?file=${file.id}\n`;
    window.dispatchEvent(
      new CustomEvent("stack62:open-email", {
        detail: { subject, body },
      }),
    );
  }, []);

  const doDownload = useCallback((file: FileRow) => {
    const a = document.createElement("a");
    a.href = fileDownloadUrl(file.id);
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const doBulkDownload = useCallback(async () => {
    // Simple per-file trigger; browsers will queue them. For >5 files
    // we warn first because some browsers throttle.
    if (selectedFiles.length > 5) {
      const ok = await appDialog.confirm({
        title: `Download ${selectedFiles.length} files?`,
        description:
          "Your browser may prompt you per file. If you'd rather get one archive, ask Coworker.",
        confirmLabel: "Download all",
      });
      if (!ok) return;
    }
    selectedFiles.forEach((f, idx) => {
      // Stagger by 200ms so Safari doesn't drop later triggers.
      setTimeout(() => doDownload(f), idx * 200);
    });
  }, [selectedFiles, doDownload]);

  const doCut = useCallback(() => {
    if (selectedIds.length === 0) return;
    setClipboard({ mode: "cut", fileIds: selectedIds });
  }, [selectedIds]);

  const doCopyToClipboard = useCallback(() => {
    if (selectedIds.length === 0) return;
    setClipboard({ mode: "copy", fileIds: selectedIds });
  }, [selectedIds]);

  const doPaste = useCallback(
    async (folderId: string | null = parentId) => {
      if (!clipboard) return;
      try {
        if (clipboard.mode === "cut") {
          await bulkMoveFiles(clipboard.fileIds, folderId);
        } else {
          await Promise.all(
            clipboard.fileIds.map((id) => copyFile(id, { folderId })),
          );
        }
        setClipboard(null);
        await reload();
      } catch (err) {
        await appDialog.alert({
          title: "Paste failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "destructive",
        });
      }
    },
    [clipboard, parentId, reload],
  );

  const doMoveTo = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const choice = await pickFolder(orgId);
      if (choice === undefined) return; // user cancelled
      try {
        await bulkMoveFiles(ids, choice);
        clearSelection();
        await reload();
      } catch (err) {
        await appDialog.alert({
          title: "Move failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "destructive",
        });
      }
    },
    [orgId, reload, clearSelection],
  );

  // Drop a dragged file (or selection) onto a folder.
  const dropOnFolder = useCallback(
    async (folderId: string | null, draggedId: string) => {
      // If the user is dragging one of the selected items, move the
      // whole selection. Otherwise just the dragged one.
      const ids = selection.has(draggedId) ? Array.from(selection) : [draggedId];
      try {
        await bulkMoveFiles(ids, folderId);
        clearSelection();
        await reload();
      } catch (err) {
        await appDialog.alert({
          title: "Move failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "destructive",
        });
      }
    },
    [selection, reload, clearSelection],
  );

  // ── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // Ignore when an input is focused.
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const cmd = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else clearSelection();
        return;
      }
      if (cmd && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
        return;
      }
      if (cmd && event.key.toLowerCase() === "x") {
        event.preventDefault();
        doCut();
        return;
      }
      if (cmd && event.key.toLowerCase() === "c") {
        event.preventDefault();
        doCopyToClipboard();
        return;
      }
      if (cmd && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void doPaste();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        void doDelete(selectedIds);
        return;
      }
      if (event.key === "F2" && lastSelectedId) {
        event.preventDefault();
        void doRename(lastSelectedId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    contextMenu,
    selectAll,
    clearSelection,
    doCut,
    doCopyToClipboard,
    doPaste,
    doDelete,
    doRename,
    selectedIds,
    lastSelectedId,
  ]);

  // Close the context menu when clicking anywhere else.
  useEffect(() => {
    if (!contextMenu) return;
    const onDoc = () => setContextMenu(null);
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [contextMenu]);

  // Close the options menu when clicking elsewhere.
  useEffect(() => {
    if (!showOptionsMenu) return;
    const onDoc = () => setShowOptionsMenu(false);
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [showOptionsMenu]);

  // Close the new submenu when clicking elsewhere.
  useEffect(() => {
    if (!showNewSubmenu) return;
    const onDoc = () => setShowNewSubmenu(false);
    window.addEventListener("click", onDoc);
    return () => window.removeEventListener("click", onDoc);
  }, [showNewSubmenu]);

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className="flex min-w-0 flex-1 flex-col"
        onClick={(e) => {
          // Click on empty surface clears selection.
          if (e.target === e.currentTarget) clearSelection();
        }}
      >
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
                if (e.key === "Enter") void runSearch();
                if (e.key === "Escape") setSearchResults(null);
              }}
              placeholder="Search by meaning, not just name…"
              className="w-72 rounded-md border border-app bg-app pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          {/* "Create new" — workspace doc/sheet/slides */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowOptionsMenu((v) => !v);
                setShowNewSubmenu(false);
              }}
              disabled={creating !== null || !workspaceId}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg shadow-sm hover:opacity-90 disabled:opacity-60"
              title={
                workspaceId
                  ? "Create new items, upload files, or connect folders"
                  : "Select a workspace first"
              }
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MoreVertical className="size-4" />
              )}
              Options
              <ChevronDown className="size-3 opacity-70" />
            </button>
            {showOptionsMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-md border border-app bg-app-elevated shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {/* New submenu trigger */}
                <div className="relative group">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNewSubmenu((v) => !v);
                    }}
                    onMouseEnter={() => setShowNewSubmenu(true)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-app-hover"
                  >
                    <div className="flex items-center gap-3">
                      <Plus className="size-4 shrink-0 text-app-muted" />
                      <span className="text-sm font-medium text-app">New</span>
                    </div>
                    <ChevronRight className="size-3 text-app-muted" />
                  </button>

                  {/* New submenu with document types */}
                  {showNewSubmenu && (
                    <div
                      role="menu"
                      className="absolute left-full top-0 ml-1 w-56 overflow-hidden rounded-md border border-app bg-app-elevated shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <NewMenuItem
                        icon={FileText}
                        label="Document"
                        description="Collaborative rich text"
                        onClick={() => {
                          setShowOptionsMenu(false);
                          setShowNewSubmenu(false);
                          void onCreateWorkspaceDoc("document", "Untitled document");
                        }}
                      />
                      <NewMenuItem
                        icon={SheetIcon}
                        label="Spreadsheet"
                        description="Cells, formulas, multi-sheet"
                        onClick={() => {
                          setShowOptionsMenu(false);
                          setShowNewSubmenu(false);
                          void onCreateWorkspaceDoc("sheet", "Untitled spreadsheet");
                        }}
                      />
                      <NewMenuItem
                        icon={Presentation}
                        label="Presentation"
                        description="Slides, shapes, present mode"
                        onClick={() => {
                          setShowOptionsMenu(false);
                          setShowNewSubmenu(false);
                          void onCreateWorkspaceDoc("slides", "Untitled presentation");
                        }}
                      />
                    </div>
                  )}
                </div>

                <MenuDivider />

                <MenuItem
                  icon={FolderPlus}
                  label="New folder"
                  onClick={() => {
                    setShowOptionsMenu(false);
                    void onCreateFolder();
                  }}
                />

                <MenuItem
                  icon={Upload}
                  label="Upload"
                  onClick={() => {
                    setShowOptionsMenu(false);
                    // Trigger file input click programmatically
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.onchange = (e) => void onUpload((e.target as HTMLInputElement).files);
                    input.click();
                  }}
                />

                <div onClick={(e) => e.stopPropagation()}>
                  <LocalFolderButton />
                </div>
              </div>
            )}
          </div>

        </div>

        {/* Selection toolbar — Drive-style float-down */}
        {selectedIds.length > 0 && (
          <SelectionToolbar
            count={selectedIds.length}
            onClear={clearSelection}
            onDelete={() => void doDelete(selectedIds)}
            onDownload={() => void doBulkDownload()}
            onShare={() => {
              if (selectedFiles[0]) doShare(selectedFiles[0]);
            }}
            onMove={() => void doMoveTo(selectedIds)}
            onCut={doCut}
            onCopy={doCopyToClipboard}
            canPaste={!!clipboard}
            onPaste={() => void doPaste()}
            onRename={
              selectedIds.length === 1
                ? () => void doRename(selectedIds[0])
                : undefined
            }
          />
        )}

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
              selection={selection}
              clipboardCutIds={
                clipboard?.mode === "cut" ? new Set(clipboard.fileIds) : null
              }
              dragOverFolderId={dragOverFolderId}
              onOpenFolder={openFolder}
              onOpenFile={openInTab}
              onShowDetails={setDetailsFileId}
              onSelect={selectOne}
              onContextMenuFile={(fileId, x, y) => {
                if (!selection.has(fileId)) selectOne(fileId, {});
                setContextMenu({ fileId, x, y });
              }}
              onDragStartFile={() => undefined}
              onDragOverFolder={(folderId) => setDragOverFolderId(folderId)}
              onDragLeaveFolder={() => setDragOverFolderId(null)}
              onDropOnFolder={(folderId, draggedId) => {
                setDragOverFolderId(null);
                void dropOnFolder(folderId, draggedId);
              }}
            />
          )}
        </div>
      </div>

      {/* Right panel: file details + OCR fields */}
      {detailsFileId && (
        <FileDetailsPanel
          fileId={detailsFileId}
          onClose={() => setDetailsFileId(null)}
          onShared={() => void reload()}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          fileId={contextMenu.fileId}
          selectionSize={selection.size}
          canPaste={!!clipboard}
          onClose={() => setContextMenu(null)}
          onOpen={() => {
            const file = files.find((f) => f.id === contextMenu.fileId);
            if (file) openInTab(file.id, file.filename);
          }}
          onRename={() => void doRename(contextMenu.fileId)}
          onDownload={() => {
            const file = files.find((f) => f.id === contextMenu.fileId);
            if (file) doDownload(file);
          }}
          onShare={() => {
            const file = files.find((f) => f.id === contextMenu.fileId);
            if (file) doShare(file);
          }}
          onCopyLink={() => {
            const file = files.find((f) => f.id === contextMenu.fileId);
            if (file) void doCopyLink(file);
          }}
          onCut={doCut}
          onCopy={doCopyToClipboard}
          onPaste={() => void doPaste()}
          onMove={() => void doMoveTo(Array.from(selection))}
          onDelete={() => void doDelete(Array.from(selection))}
        />
      )}
    </div>
  );
}

// ── Selection toolbar ────────────────────────────────────────────

function SelectionToolbar({
  count,
  onClear,
  onDelete,
  onDownload,
  onShare,
  onMove,
  onCut,
  onCopy,
  onPaste,
  onRename,
  canPaste,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onShare: () => void;
  onMove: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRename?: () => void;
  canPaste: boolean;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-app bg-accent-soft px-4 py-2 text-sm">
      <button
        onClick={onClear}
        className="rounded p-1 text-app-muted hover:bg-app-hover"
        title="Clear selection (Esc)"
      >
        <X className="size-4" />
      </button>
      <span className="ml-1 font-medium">
        {count} selected
      </span>
      <div className="ml-3 h-5 w-px bg-app" />
      <ToolbarBtn icon={Download} label="Download" onClick={onDownload} />
      <ToolbarBtn icon={Share2} label="Share" onClick={onShare} />
      {onRename && (
        <ToolbarBtn icon={Edit3} label="Rename" onClick={onRename} />
      )}
      <ToolbarBtn icon={FolderInput} label="Move to…" onClick={onMove} />
      <div className="mx-1 h-5 w-px bg-app" />
      <ToolbarBtn icon={Scissors} label="Cut" onClick={onCut} />
      <ToolbarBtn icon={Copy} label="Copy" onClick={onCopy} />
      <ToolbarBtn
        icon={ClipboardCopy}
        label="Paste"
        onClick={onPaste}
        disabled={!canPaste}
      />
      <div className="mx-1 h-5 w-px bg-app" />
      <ToolbarBtn
        icon={Trash2}
        label="Delete"
        onClick={onDelete}
        danger
      />
    </div>
  );
}

function ToolbarBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Download;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
        disabled
          ? "text-app-faint opacity-50"
          : danger
            ? "text-rose-300 hover:bg-rose-950/40"
            : "text-app-muted hover:bg-app-hover hover:text-app"
      }`}
    >
      <Icon className="size-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// ── Context menu ────────────────────────────────────────────────

function ContextMenu({
  x,
  y,
  selectionSize,
  canPaste,
  onClose,
  onOpen,
  onRename,
  onDownload,
  onShare,
  onCopyLink,
  onCut,
  onCopy,
  onPaste,
  onMove,
  onDelete,
}: {
  x: number;
  y: number;
  fileId: string;
  selectionSize: number;
  canPaste: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDownload: () => void;
  onShare: () => void;
  onCopyLink: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  // Clamp to viewport so a click near the edge doesn't push the menu offscreen.
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 360);
  const isMulti = selectionSize > 1;
  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <ul
      className="fixed z-50 w-56 overflow-hidden rounded-md border border-app bg-app-elevated py-1 text-sm shadow-lg"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      {!isMulti && (
        <MenuItem icon={Info} label="Open" onClick={wrap(onOpen)} />
      )}
      <MenuItem icon={Download} label={isMulti ? `Download ${selectionSize}` : "Download"} onClick={wrap(onDownload)} />
      <MenuItem icon={Share2} label="Share…" onClick={wrap(onShare)} />
      {!isMulti && (
        <>
          <MenuItem icon={ClipboardCopy} label="Copy link" onClick={wrap(onCopyLink)} />
          <MenuItem icon={Edit3} label="Rename" onClick={wrap(onRename)} />
        </>
      )}
      <MenuDivider />
      <MenuItem icon={Scissors} label={`Cut${isMulti ? ` ${selectionSize}` : ""}`} onClick={wrap(onCut)} />
      <MenuItem icon={Copy} label={`Copy${isMulti ? ` ${selectionSize}` : ""}`} onClick={wrap(onCopy)} />
      <MenuItem
        icon={ClipboardCopy}
        label="Paste"
        onClick={wrap(onPaste)}
        disabled={!canPaste}
      />
      <MenuItem icon={FolderInput} label="Move to…" onClick={wrap(onMove)} />
      <MenuDivider />
      <MenuItem
        icon={Trash2}
        label={`Delete${isMulti ? ` ${selectionSize}` : ""}`}
        onClick={wrap(onDelete)}
        danger
      />
    </ul>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Info;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
          disabled
            ? "text-app-faint opacity-50"
            : danger
              ? "text-rose-400 hover:bg-rose-950/40"
              : "text-app hover:bg-app-hover"
        }`}
      >
        <Icon className="size-3.5" />
        {label}
      </button>
    </li>
  );
}

function MenuDivider() {
  return <li className="my-1 border-t border-app" />;
}

// ── Move-to picker ───────────────────────────────────────────────

/**
 * Walk the folder tree and let the user pick a destination. Returns
 * the chosen folderId (or null for root), or `undefined` if cancelled.
 *
 * Implementation is a simple flat list of all folders we can see in
 * the org. Larger orgs will want a real tree picker; for now this
 * matches Drive's "Move to" modal feel.
 */
async function pickFolder(orgId: string): Promise<string | null | undefined> {
  if (!orgId) return undefined;
  // Use the existing folders endpoint at the root and recurse one level
  // — good enough for the typical 2-3 level hierarchy people actually
  // build. Deeper picks still work via cut/paste while navigated to
  // the destination.
  const roots = await foldersApi.list(orgId).catch(() => []);
  const choices: Array<{ id: string | null; label: string }> = [
    { id: null, label: "Files (root)" },
    ...roots.map((f) => ({ id: f.id, label: f.name })),
  ];
  // Append child folders one level deep for each root.
  for (const r of roots) {
    const children = await foldersApi.list(orgId, r.id).catch(() => []);
    for (const c of children) {
      choices.push({ id: c.id, label: `${r.name} / ${c.name}` });
    }
  }
  // Render a one-off picker via the app dialog by prompting with a
  // labelled select. We don't have a dropdown variant in appDialog yet,
  // so render an inline modal instead.
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cleanup = () => {
      host.remove();
    };
    // Simple inline modal — black backdrop + Drive-style list.
    const backdrop = document.createElement("div");
    backdrop.className =
      "fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4";
    backdrop.onclick = (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve(undefined);
      }
    };
    backdrop.innerHTML = `
      <div class="w-full max-w-sm rounded-lg border border-app bg-app-surface text-app shadow-xl">
        <div class="border-b border-app px-4 py-3 text-sm font-semibold">Move to…</div>
        <ul class="max-h-80 overflow-y-auto py-1">
          ${choices
            .map(
              (c, idx) =>
                `<li><button data-idx="${idx}" class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-app-hover">${escapeHtml(c.label)}</button></li>`,
            )
            .join("")}
        </ul>
        <div class="flex justify-end gap-2 border-t border-app px-3 py-2">
          <button data-cancel class="rounded-md border border-app px-3 py-1 text-xs hover:bg-app-hover">Cancel</button>
        </div>
      </div>
    `;
    backdrop.querySelector("[data-cancel]")?.addEventListener("click", () => {
      cleanup();
      resolve(undefined);
    });
    backdrop.querySelectorAll<HTMLButtonElement>("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        cleanup();
        resolve(choices[idx].id);
      });
    });
    host.appendChild(backdrop);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Breadcrumb ───────────────────────────────────────────────────

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

// ── Browse view ──────────────────────────────────────────────────

function BrowseView({
  folders,
  files,
  loading,
  selection,
  clipboardCutIds,
  dragOverFolderId,
  onOpenFolder,
  onOpenFile,
  onShowDetails,
  onSelect,
  onContextMenuFile,
  onDragStartFile,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: {
  folders: FolderDto[];
  files: FileRow[];
  loading: boolean;
  selection: Set<string>;
  clipboardCutIds: Set<string> | null;
  dragOverFolderId: string | null;
  onOpenFolder: (f: FolderDto) => void;
  onOpenFile: (id: string, filename: string) => void;
  onShowDetails: (id: string) => void;
  onSelect: (
    id: string,
    ev: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ) => void;
  onContextMenuFile: (fileId: string, x: number, y: number) => void;
  onDragStartFile: (fileId: string) => void;
  onDragOverFolder: (folderId: string | null) => void;
  onDragLeaveFolder: () => void;
  onDropOnFolder: (folderId: string | null, draggedId: string) => void;
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
                onDragOver={(e) => {
                  // Only accept file drops (not external).
                  if (e.dataTransfer.types.includes("application/x-stack62-file")) {
                    e.preventDefault();
                    onDragOverFolder(f.id);
                  }
                }}
                onDragLeave={() => onDragLeaveFolder()}
                onDrop={(e) => {
                  const draggedId = e.dataTransfer.getData(
                    "application/x-stack62-file",
                  );
                  if (draggedId) {
                    e.preventDefault();
                    onDropOnFolder(f.id, draggedId);
                  }
                }}
                className={`group flex items-center gap-2 rounded-lg border bg-app-elevated px-3 py-3 text-left text-sm transition ${
                  dragOverFolderId === f.id
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-app hover:border-accent hover:shadow-sm"
                }`}
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
          {/* Filter chips */}
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
                  selected={selection.has(file.id)}
                  cut={clipboardCutIds?.has(file.id) ?? false}
                  onOpen={() => onOpenFile(file.id, file.filename)}
                  onShowDetails={() => onShowDetails(file.id)}
                  onSelect={(ev) => onSelect(file.id, ev)}
                  onContextMenu={(x, y) => onContextMenuFile(file.id, x, y)}
                  onDragStart={() => onDragStartFile(file.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── File tile ────────────────────────────────────────────────────

function FileTile({
  file,
  selected,
  cut,
  onOpen,
  onShowDetails,
  onSelect,
  onContextMenu,
  onDragStart,
}: {
  file: FileRow;
  selected: boolean;
  cut: boolean;
  onOpen: () => void;
  onShowDetails: () => void;
  onSelect: (ev: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  }) => void;
  onContextMenu: (x: number, y: number) => void;
  onDragStart: () => void;
}) {
  const ext = (file.filename.split(".").pop() || "").toLowerCase();
  const mt = file.mimeType.toLowerCase();
  const isImage =
    mt.startsWith("image/") || /png|jpe?g|gif|webp|svg/.test(ext);

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

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      ref={tileRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      draggable
      onDragStart={(e) => {
        // Use a custom MIME so we don't conflict with native file drops.
        e.dataTransfer.setData("application/x-stack62-file", file.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        // Click selects (with modifier handling). Double-click opens.
        if (e.detail >= 2) {
          onOpen();
          return;
        }
        onSelect({
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
        });
      }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-app-elevated transition ${
        selected
          ? "border-accent shadow-md ring-2 ring-accent/40"
          : "border-app hover:border-accent hover:shadow-sm"
      } ${cut ? "opacity-50" : ""}`}
    >
      {/* Selection checkbox in top-left corner — Drive-style; visible
          on hover unless something is already selected. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ ctrlKey: true }); // toggle via ctrl-like logic
        }}
        title={selected ? "Unselect" : "Select"}
        className={`absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md transition ${
          selected
            ? "bg-accent text-accent-fg opacity-100"
            : "bg-app-elevated/95 text-app-muted opacity-0 shadow-sm backdrop-blur group-hover:opacity-100"
        }`}
      >
        {selected ? (
          <SquareCheck className="size-3.5" />
        ) : (
          <Square className="size-3.5" />
        )}
      </button>

      <div className="flex flex-1 flex-col items-stretch p-0 text-left">
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
              draggable={false}
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
      </div>

      {/* Hover overlay top-right: details + 3-dot */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowDetails();
          }}
          className="grid h-7 w-7 place-items-center rounded-md bg-app-elevated/95 text-app-muted shadow-sm backdrop-blur hover:text-app"
          title="Show details"
        >
          <Info className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e.clientX, e.clientY);
          }}
          className="grid h-7 w-7 place-items-center rounded-md bg-app-elevated/95 text-app-muted shadow-sm backdrop-blur hover:text-app"
          title="More actions"
        >
          <MoreVertical className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Search results ──────────────────────────────────────────────

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

// ── Details panel ───────────────────────────────────────────────

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
            onClick={() => void runExtraction()}
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
                onClick={() => void sendShare()}
                disabled={submitting || !email.trim()}
                className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </section>

          <div className="border-t border-app" />

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
                onClick={() => void createLink()}
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
                      onClick={() => void revoke(s.id)}
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

// ── Local-folder button ─────────────────────────────────────────

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
        onClick={() => void onClick()}
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
          onClick={() => void onDisconnect()}
          title="Disconnect the local folder"
          className="rounded-md border border-app px-2 py-1.5 text-app-faint hover:bg-app-hover"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function NewMenuItem({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-app-hover"
    >
      <Icon className="size-4 shrink-0 text-app-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-app">{label}</div>
        <div className="text-[11px] text-app-faint">{description}</div>
      </div>
    </button>
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

// Allow drop-to-root by accepting drops on the breadcrumb root.
// (Future: render an explicit "Files (root)" drop zone above the
// folder grid for clarity. For now, the Move-to picker handles this.)
export const __testExport = { humanBytes };

// Suppress unused-imports lint for the Move icon — kept reserved for
// future "drag-to-here" affordance in the toolbar.
void Move;

