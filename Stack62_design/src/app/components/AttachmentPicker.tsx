import { useEffect, useState } from "react";
import {
  FileText,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Music,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  importGoogleDriveFile,
  listFiles,
  listGoogleDriveFiles,
  uploadFile,
  type DriveFile,
  type StoredFile,
} from "../lib/resources";

type Source = "desktop" | "library" | "drive";

/**
 * Unified attachment-source picker. Lets the user attach a file from three
 * places — their desktop, their Stack62 file library, or their Google Drive —
 * and resolves every choice to a StoredFile already in the Stack62 store, so
 * callers only ever deal with a file id.
 */
export function AttachmentPicker({
  organizationId,
  workspaceId,
  open,
  onClose,
  onPicked,
  accept,
  title = "Attach a file",
}: {
  organizationId: string;
  workspaceId?: string | null;
  open: boolean;
  onClose: () => void;
  onPicked: (file: StoredFile) => void;
  /** Optional HTML accept filter for the desktop input (e.g. "image/*"). */
  accept?: string;
  title?: string;
}) {
  const [source, setSource] = useState<Source>("library");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const pick = async (run: () => Promise<StoredFile>) => {
    setBusy(true);
    setError(null);
    try {
      const file = await run();
      onPicked(file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't attach that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[28rem] w-full max-w-md flex-col overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-app px-3 py-2">
          <span className="text-sm font-semibold text-app">{title}</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-app-muted hover:bg-app-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source tabs */}
        <div className="flex gap-0.5 border-b border-app p-1.5">
          <SourceTab
            active={source === "library"}
            onClick={() => setSource("library")}
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label="Library"
          />
          <SourceTab
            active={source === "drive"}
            onClick={() => setSource("drive")}
            icon={<DriveGlyph />}
            label="Google Drive"
          />
          <SourceTab
            active={source === "desktop"}
            onClick={() => setSource("desktop")}
            icon={<Upload className="h-3.5 w-3.5" />}
            label="Desktop"
          />
        </div>

        {error && (
          <p className="mx-3 mt-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {error}
          </p>
        )}

        <div className="relative min-h-0 flex-1 overflow-auto">
          {busy && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-app-elevated/70">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          )}
          {source === "desktop" && (
            <DesktopSource
              accept={accept}
              onFile={(file) =>
                void pick(() =>
                  uploadFile({
                    file,
                    organizationId,
                    workspaceId: workspaceId ?? undefined,
                    scope: "attachment",
                  }),
                )
              }
            />
          )}
          {source === "library" && (
            <LibrarySource
              organizationId={organizationId}
              workspaceId={workspaceId}
              onPick={(f) => {
                onPicked(f);
                onClose();
              }}
            />
          )}
          {source === "drive" && (
            <DriveSource
              organizationId={organizationId}
              workspaceId={workspaceId}
              onImport={(driveFileId) =>
                void pick(() =>
                  importGoogleDriveFile({
                    organizationId,
                    workspaceId: workspaceId ?? undefined,
                    fileId: driveFileId,
                  }),
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SourceTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
        active
          ? "bg-accent text-accent-fg shadow-sm"
          : "text-app-muted hover:bg-app-hover hover:text-app"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function DesktopSource({
  accept,
  onFile,
}: {
  accept?: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="m-3 flex h-[20rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-app text-center hover:border-accent">
      <Upload className="h-6 w-6 text-app-muted" />
      <span className="text-sm font-medium text-app">Choose a file</span>
      <span className="text-[11px] text-app-faint">
        from this device to upload &amp; attach
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function LibrarySource({
  organizationId,
  workspaceId,
  onPick,
}: {
  organizationId: string;
  workspaceId?: string | null;
  onPick: (f: StoredFile) => void;
}) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    listFiles({ organizationId, workspaceId: workspaceId ?? undefined })
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [organizationId, workspaceId]);

  const filtered = files.filter((f) =>
    f.filename.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your files…"
          className="w-full rounded-md border border-app bg-app px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {loading ? (
          <p className="px-2 py-3 text-[11px] text-app-subtle">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-app-subtle">
            No files. Upload some, or pick from Desktop / Google Drive.
          </p>
        ) : (
          filtered.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onPick(f)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-hover"
            >
              <FileGlyph mimeType={f.mimeType} />
              <span className="min-w-0 flex-1 truncate text-xs">{f.filename}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function DriveSource({
  organizationId,
  workspaceId,
  onImport,
}: {
  organizationId: string;
  workspaceId?: string | null;
  onImport: (driveFileId: string) => void;
}) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      listGoogleDriveFiles({
        organizationId,
        workspaceId: workspaceId ?? undefined,
        query: query.trim() || undefined,
      })
        .then(setFiles)
        .catch((err) =>
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't reach Google Drive. Connect Google under Tools → Marketplace.",
          ),
        )
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [organizationId, workspaceId, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Google Drive…"
          className="w-full rounded-md border border-app bg-app px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {loading ? (
          <p className="px-2 py-3 text-[11px] text-app-subtle">Loading…</p>
        ) : error ? (
          <p className="px-2 py-3 text-[11px] text-rose-500">{error}</p>
        ) : files.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-app-subtle">
            No Drive files found.
          </p>
        ) : (
          files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onImport(f.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-hover"
            >
              {f.iconLink ? (
                <img src={f.iconLink} alt="" className="h-4 w-4" />
              ) : (
                <FileGlyph mimeType={f.mimeType} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function FileGlyph({ mimeType }: { mimeType: string }) {
  const mt = mimeType.toLowerCase();
  if (mt.startsWith("image/"))
    return <ImageIcon className="h-4 w-4 shrink-0 text-rose-500" />;
  if (mt.startsWith("video/"))
    return <Video className="h-4 w-4 shrink-0 text-purple-500" />;
  if (mt.startsWith("audio/"))
    return <Music className="h-4 w-4 shrink-0 text-indigo-500" />;
  return <FileText className="h-4 w-4 shrink-0 text-accent" />;
}

function DriveGlyph() {
  // Tiny Google Drive triangle mark.
  return (
    <svg viewBox="0 0 87.3 78" className="h-3.5 w-3.5">
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}
