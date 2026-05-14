/**
 * Local-folder access via the File System Access API. Lets the user
 * grant Stack62 read (and optionally read/write) access to a folder
 * on their computer — every file inside becomes available to the
 * Coworker without first having to upload it.
 *
 * Limitations of a web app:
 *   - Supported in Chromium-family browsers only (Chrome, Edge, Brave,
 *     Opera). Firefox and Safari don't expose `showDirectoryPicker`.
 *   - The handle is permission-gated and ephemeral by default. We
 *     persist it via IndexedDB so the same folder can be re-used
 *     across sessions; on each session the browser will prompt the
 *     user once to re-confirm access.
 *   - For a full "installed app" experience with always-on full disk
 *     access (no per-session prompt), Stack62 would need to ship a
 *     desktop wrapper (Tauri/Electron). Web platform alone can't
 *     promise more than what's here.
 */

const DB_NAME = "stack62-local-fs";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "primary";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(
      (req.result as FileSystemDirectoryHandle | null) ?? null,
    );
    req.onerror = () => resolve(null);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearHandle(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface LocalFolderEntry {
  /** Path inside the connected folder, e.g. "docs/2026/spec.md". */
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number | null;
  lastModified: number | null;
}

export const localFolder = {
  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.showDirectoryPicker === "function"
    );
  },

  async getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.isSupported()) return null;
    return loadHandle();
  },

  async connect(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.isSupported()) return null;
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite" as "read" | "readwrite",
      });
      await storeHandle(handle);
      return handle;
    } catch {
      // User cancelled the picker.
      return null;
    }
  },

  async disconnect(): Promise<void> {
    await clearHandle();
  },

  /**
   * Walk the connected folder up to `maxDepth` levels deep and return
   * a flat listing. The default depth is 4 — enough for most working
   * folders without choking the UI for huge trees.
   */
  async list(
    handle: FileSystemDirectoryHandle,
    maxDepth = 4,
    maxEntries = 2000,
  ): Promise<LocalFolderEntry[]> {
    const out: LocalFolderEntry[] = [];
    const walk = async (
      dir: FileSystemDirectoryHandle,
      prefix: string,
      depth: number,
    ): Promise<void> => {
      if (depth > maxDepth || out.length >= maxEntries) return;
      // The for-await iterator is the supported way to enumerate.
      for await (const entry of dir.values()) {
        if (out.length >= maxEntries) return;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          out.push({
            path,
            name: entry.name,
            kind: "directory",
            size: null,
            lastModified: null,
          });
          await walk(entry, path, depth + 1);
        } else {
          try {
            const file = await entry.getFile();
            out.push({
              path,
              name: entry.name,
              kind: "file",
              size: file.size,
              lastModified: file.lastModified,
            });
          } catch {
            // Permission may have been revoked silently; skip.
          }
        }
      }
    };
    await walk(handle, "", 0);
    return out;
  },

  /**
   * Reads a file by path relative to the connected folder. Throws if
   * the user has revoked permission or the file doesn't exist.
   */
  async readFile(
    handle: FileSystemDirectoryHandle,
    path: string,
  ): Promise<File> {
    const parts = path.split("/").filter(Boolean);
    let dir: FileSystemDirectoryHandle = handle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    return fileHandle.getFile();
  },
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
