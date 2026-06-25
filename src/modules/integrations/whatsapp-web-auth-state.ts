/**
 * A Baileys `AuthenticationState` backed by a single in-memory object that is
 * flushed to Postgres on every change.
 *
 * Baileys ships `useMultiFileAuthState`, which writes creds + signal keys to
 * disk. Stack62 runs on Render where the filesystem is ephemeral, so we keep
 * the whole `{ creds, keys }` blob in memory and persist it (BufferJSON +
 * AES-GCM) via the caller's `persist` callback. The key-store `get`/`set`
 * semantics mirror Baileys' own file store so signal decryption behaves
 * identically.
 *
 * Baileys is loaded with a dynamic `import()` (it is ESM-only) so we type the
 * module as `any` here — the shapes below are stable across Baileys 6.x.
 */

/* Baileys is loaded via dynamic import and typed `any`; see service header. */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
export type BaileysApi = any;

export interface StoredAuthState {
  creds: Record<string, unknown>;
  keys: Record<string, Record<string, unknown>>;
}

export interface AuthStateHandle {
  state: any;
  saveCreds: () => Promise<void>;
  snapshot: () => StoredAuthState;
}

/**
 * Serialize an auth-state snapshot to a plain string using Baileys' BufferJSON
 * replacer (Buffers/Uint8Arrays are encoded so JSON survives a round-trip).
 */
export function serializeAuthState(
  baileys: BaileysApi,
  snapshot: StoredAuthState,
): string {
  return JSON.stringify(snapshot, baileys.BufferJSON.replacer);
}

/** Inverse of {@link serializeAuthState}. */
export function deserializeAuthState(
  baileys: BaileysApi,
  serialized: string,
): StoredAuthState {
  const parsed = JSON.parse(
    serialized,
    baileys.BufferJSON.reviver,
  ) as Partial<StoredAuthState>;
  return {
    creds: parsed.creds ?? baileys.initAuthCreds(),
    keys: parsed.keys ?? {},
  };
}

/**
 * Build a live `AuthenticationState` from a stored snapshot (or a fresh one
 * when `initial` is null). `persist` is called whenever creds or keys change.
 */
export function makeInMemoryAuthState(
  baileys: BaileysApi,
  initial: StoredAuthState | null,
  persist: (snapshot: StoredAuthState) => Promise<void>,
): AuthStateHandle {
  const creds = initial?.creds ?? baileys.initAuthCreds();
  const keys: Record<string, Record<string, unknown>> = initial?.keys ?? {};

  const snapshot = (): StoredAuthState => ({ creds, keys });

  const state = {
    creds,
    keys: {
      get: (type: string, ids: string[]) => {
        const out: Record<string, unknown> = {};
        const store = keys[type] ?? {};
        for (const id of ids) {
          let value = store[id];
          if (value !== undefined && value !== null) {
            if (type === 'app-state-sync-key') {
              value =
                baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            out[id] = value;
          }
        }
        return out;
      },
      set: async (data: Record<string, Record<string, unknown> | null>) => {
        for (const type of Object.keys(data)) {
          const entries = data[type] ?? {};
          keys[type] = keys[type] ?? {};
          for (const id of Object.keys(entries)) {
            const value = entries[id];
            if (value === null || value === undefined) {
              delete keys[type][id];
            } else {
              keys[type][id] = value;
            }
          }
        }
        await persist(snapshot());
      },
    },
  };

  return {
    state,
    saveCreds: async () => persist(snapshot()),
    snapshot,
  };
}
