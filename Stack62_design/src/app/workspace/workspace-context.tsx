import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { DocumentFormat } from "../lib/resources";

export type ActivityKey =
  | "home"
  | "explorer"
  | "coworker"
  | "flow"
  | "systems"
  | "documents"
  | "files"
  | "records"
  | "tasks"
  | "schedules"
  | "reports"
  | "templates"
  | "tools"
  | "teams"
  | "settings";

export type EditorKind =
  | "welcome"
  | "file"
  | "document"
  | "system"
  | "module"
  | "workflow"
  | "plan"
  | "preview"
  | "history"
  | "share"
  | "task"
  | "schedule"
  | "report"
  | "flow"
  | "job"
  | "templates"
  | "tools"
  | "teams"
  | "files-explorer"
  | "room"
  | "streaming-doc"
  | "meeting-bot"
  | "settings";

/**
 * A point in a tab's navigation history. Equivalent to a single page in a
 * browser tab.
 */
export interface EditorRoute {
  kind: EditorKind;
  title: string;
  refId?: string;
  parentRefId?: string;
  meta?: Record<string, string>;
}

/**
 * Public, flattened tab shape. Editors and the TabBar continue reading
 * `kind`, `title`, `refId`, etc. just as before — internally these are the
 * fields of the route at `history[index]`.
 */
export interface EditorTab extends EditorRoute {
  id: string;
  dirty?: boolean;
  pinned?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface TabState {
  id: string;
  history: EditorRoute[];
  index: number;
  dirty?: boolean;
  pinned?: boolean;
}

export interface RunLogEntry {
  id: string;
  ts: number;
  level: "info" | "ok" | "warn" | "error";
  text: string;
  source?: string;
}

export type ConversationIntent = "system" | "job" | "schedule";

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ConversationState {
  intent: ConversationIntent;
  preamble: string;
  messages: ConversationMessage[];
  thinking: boolean;
}

export interface FileDraft {
  format: DocumentFormat;
  title: string;
  generating: boolean;
}

export interface NavigateOptions {
  newTab?: boolean;
}

interface WorkspaceContextValue {
  activity: ActivityKey;
  setActivity: (key: ActivityKey) => void;

  tabs: EditorTab[];
  activeTabId: string | null;
  activeTab: EditorTab | null;

  /** Open a new tab. Always creates one. */
  openTab: (route: EditorRoute & { id?: string }) => EditorTab;
  /**
   * Navigate the active tab to `route`, pushing onto its history (browser-style).
   * If no tab exists, creates one. Pass `{ newTab: true }` to force a new tab.
   */
  navigate: (route: EditorRoute, opts?: NavigateOptions) => EditorTab;

  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Patch the *current route* of the given tab (title, refId, dirty, etc.). */
  updateTab: (id: string, patch: Partial<EditorTab>) => void;

  back: (id?: string) => void;
  forward: (id?: string) => void;

  reorderTabs: (fromId: string, toId: string) => void;
  togglePinTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;

  runOpen: boolean;
  setRunOpen: (open: boolean) => void;
  runLog: RunLogEntry[];
  appendRunLog: (entry: Omit<RunLogEntry, "id" | "ts">) => void;
  clearRunLog: () => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  autopilot: boolean;
  setAutopilot: (on: boolean) => void;

  conversations: Record<string, ConversationState | undefined>;
  ensureConversation: (
    tabId: string,
    intent: ConversationIntent,
    intro: string,
    preamble: string,
  ) => ConversationState;
  appendMessage: (
    tabId: string,
    role: ConversationMessage["role"],
    text: string,
  ) => void;
  setConversationThinking: (tabId: string, thinking: boolean) => void;

  fileDrafts: Record<string, FileDraft | undefined>;
  setFileDraft: (tabId: string, patch: Partial<FileDraft>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

const initialState: TabState = {
  id: "tab-welcome",
  history: [{ kind: "welcome", title: "Welcome" }],
  index: 0,
};

function flatten(state: TabState): EditorTab {
  const route = state.history[state.index];
  return {
    id: state.id,
    kind: route.kind,
    title: route.title,
    refId: route.refId,
    parentRefId: route.parentRefId,
    meta: route.meta,
    dirty: state.dirty,
    pinned: state.pinned,
    canGoBack: state.index > 0,
    canGoForward: state.index < state.history.length - 1,
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<ActivityKey>("flow");
  const [states, setStates] = useState<TabState[]>([initialState]);
  const [activeTabId, setActiveTabId] = useState<string | null>("tab-welcome");
  const [runOpen, setRunOpen] = useState(false);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autopilot, setAutopilotState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("stack62.autopilot");
      return saved == null ? true : saved === "1";
    } catch {
      return true;
    }
  });
  const setAutopilot = useCallback((on: boolean) => {
    setAutopilotState(on);
    try {
      localStorage.setItem("stack62.autopilot", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const [conversations, setConversations] = useState<
    Record<string, ConversationState | undefined>
  >({});
  const [fileDrafts, setFileDrafts] = useState<
    Record<string, FileDraft | undefined>
  >({});

  const openTab = useCallback<WorkspaceContextValue["openTab"]>((input) => {
    const id = input.id ?? uid(input.kind);
    let createdState: TabState | null = null;
    setStates((cur) => {
      // Dedup: if an existing tab is currently displaying this route, focus it.
      if (input.refId) {
        const existing = cur.find((s) => {
          const r = s.history[s.index];
          return r.kind === input.kind && r.refId === input.refId;
        });
        if (existing) {
          createdState = existing;
          setActiveTabId(existing.id);
          return cur;
        }
      }
      const route: EditorRoute = {
        kind: input.kind,
        title: input.title,
        refId: input.refId,
        parentRefId: input.parentRefId,
        meta: input.meta,
      };
      const fresh: TabState = { id, history: [route], index: 0 };
      createdState = fresh;
      setActiveTabId(id);
      return [...cur, fresh];
    });
    return flatten(createdState ?? { id, history: [input], index: 0 });
  }, []);

  const navigate = useCallback<WorkspaceContextValue["navigate"]>(
    (route, opts) => {
      if (opts?.newTab) return openTab(route);

      const id = activeTabId;
      let resultState: TabState | null = null;
      setStates((cur) => {
        if (cur.length === 0 || !id) {
          // No active tab → just create one.
          const fresh: TabState = {
            id: uid(route.kind),
            history: [route],
            index: 0,
          };
          resultState = fresh;
          setActiveTabId(fresh.id);
          return [fresh];
        }
        return cur.map((s) => {
          if (s.id !== id) return s;
          const currentRoute = s.history[s.index];
          // Avoid pushing duplicate consecutive entries.
          if (
            currentRoute.kind === route.kind &&
            currentRoute.refId === route.refId &&
            currentRoute.parentRefId === route.parentRefId
          ) {
            // Update title/meta but don't grow history.
            const updated = {
              ...s,
              history: s.history.map((h, i) =>
                i === s.index ? { ...currentRoute, ...route } : h,
              ),
            };
            resultState = updated;
            return updated;
          }
          // Truncate forward and append.
          const truncated = s.history.slice(0, s.index + 1);
          const next: TabState = {
            ...s,
            history: [...truncated, route],
            index: truncated.length,
            dirty: false,
          };
          resultState = next;
          return next;
        });
      });
      return flatten(resultState ?? { id: id ?? "", history: [route], index: 0 });
    },
    [activeTabId, openTab],
  );

  const closeTab = useCallback((id: string) => {
    setStates((cur) => {
      if (cur.length === 1) return cur;
      const next = cur.filter((s) => s.id !== id);
      setActiveTabId((curId) =>
        curId === id ? next[next.length - 1]?.id ?? null : curId,
      );
      return next;
    });
    setConversations((cur) => {
      if (!cur[id]) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setFileDrafts((cur) => {
      if (!cur[id]) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  const setActiveTab = useCallback((id: string) => setActiveTabId(id), []);

  const updateTab = useCallback<WorkspaceContextValue["updateTab"]>(
    (id, patch) => {
      setStates((cur) =>
        cur.map((s) => {
          if (s.id !== id) return s;
          const next = { ...s };
          if (patch.dirty !== undefined) next.dirty = patch.dirty;
          if (patch.pinned !== undefined) next.pinned = patch.pinned;
          // If the route fields changed, patch the current history entry.
          if (
            patch.kind !== undefined ||
            patch.title !== undefined ||
            patch.refId !== undefined ||
            patch.parentRefId !== undefined ||
            patch.meta !== undefined
          ) {
            const cur = next.history[next.index];
            const nextRoute: EditorRoute = {
              kind: patch.kind ?? cur.kind,
              title: patch.title ?? cur.title,
              refId: patch.refId !== undefined ? patch.refId : cur.refId,
              parentRefId:
                patch.parentRefId !== undefined
                  ? patch.parentRefId
                  : cur.parentRefId,
              meta: patch.meta !== undefined ? patch.meta : cur.meta,
            };
            next.history = next.history.map((r, i) =>
              i === next.index ? nextRoute : r,
            );
          }
          return next;
        }),
      );
    },
    [],
  );

  const back = useCallback<WorkspaceContextValue["back"]>(
    (id) => {
      const targetId = id ?? activeTabId;
      if (!targetId) return;
      setStates((cur) =>
        cur.map((s) => {
          if (s.id !== targetId || s.index <= 0) return s;
          return { ...s, index: s.index - 1 };
        }),
      );
    },
    [activeTabId],
  );

  const forward = useCallback<WorkspaceContextValue["forward"]>(
    (id) => {
      const targetId = id ?? activeTabId;
      if (!targetId) return;
      setStates((cur) =>
        cur.map((s) => {
          if (s.id !== targetId || s.index >= s.history.length - 1) return s;
          return { ...s, index: s.index + 1 };
        }),
      );
    },
    [activeTabId],
  );

  const reorderTabs = useCallback<WorkspaceContextValue["reorderTabs"]>(
    (fromId, toId) => {
      if (fromId === toId) return;
      setStates((cur) => {
        const fromIdx = cur.findIndex((s) => s.id === fromId);
        const toIdx = cur.findIndex((s) => s.id === toId);
        if (fromIdx < 0 || toIdx < 0) return cur;
        const next = [...cur];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [],
  );

  const togglePinTab = useCallback<WorkspaceContextValue["togglePinTab"]>(
    (id) => {
      setStates((cur) => {
        const idx = cur.findIndex((s) => s.id === id);
        if (idx < 0) return cur;
        const target = cur[idx];
        const nextPinned = !target.pinned;
        const updated: TabState = { ...target, pinned: nextPinned };
        const others = cur.filter((s) => s.id !== id);
        const pinned = others.filter((s) => s.pinned);
        const unpinned = others.filter((s) => !s.pinned);
        return nextPinned
          ? [...pinned, updated, ...unpinned]
          : [...pinned, ...unpinned, updated];
      });
    },
    [],
  );

  const closeOthers = useCallback<WorkspaceContextValue["closeOthers"]>(
    (id) => {
      setStates((cur) => cur.filter((s) => s.id === id || s.pinned));
      setActiveTabId(id);
    },
    [],
  );

  const closeAll = useCallback<WorkspaceContextValue["closeAll"]>(() => {
    setStates((cur) => {
      const pinned = cur.filter((s) => s.pinned);
      if (pinned.length === 0) {
        setActiveTabId(initialState.id);
        return [initialState];
      }
      setActiveTabId(pinned[0].id);
      return pinned;
    });
  }, []);

  const appendRunLog = useCallback<WorkspaceContextValue["appendRunLog"]>(
    (entry) => {
      setRunLog((cur) =>
        [{ ...entry, id: uid("log"), ts: Date.now() }, ...cur].slice(0, 500),
      );
    },
    [],
  );

  const clearRunLog = useCallback(() => setRunLog([]), []);

  const ensureConversation = useCallback<
    WorkspaceContextValue["ensureConversation"]
  >((tabId, intent, intro, preamble) => {
    let state: ConversationState | undefined;
    setConversations((cur) => {
      if (cur[tabId]) {
        state = cur[tabId];
        return cur;
      }
      const next: ConversationState = {
        intent,
        preamble,
        messages: [{ role: "assistant", text: intro }],
        thinking: false,
      };
      state = next;
      return { ...cur, [tabId]: next };
    });
    return state as ConversationState;
  }, []);

  const appendMessage = useCallback<WorkspaceContextValue["appendMessage"]>(
    (tabId, role, text) => {
      setConversations((cur) => {
        const existing = cur[tabId];
        if (!existing) return cur;
        return {
          ...cur,
          [tabId]: {
            ...existing,
            messages: [...existing.messages, { role, text }],
          },
        };
      });
    },
    [],
  );

  const setConversationThinking = useCallback<
    WorkspaceContextValue["setConversationThinking"]
  >((tabId, thinking) => {
    setConversations((cur) => {
      const existing = cur[tabId];
      if (!existing) return cur;
      return { ...cur, [tabId]: { ...existing, thinking } };
    });
  }, []);

  const setFileDraft = useCallback<WorkspaceContextValue["setFileDraft"]>(
    (tabId, patch) => {
      setFileDrafts((cur) => {
        const existing = cur[tabId] ?? {
          format: "docx" as DocumentFormat,
          title: "",
          generating: false,
        };
        return { ...cur, [tabId]: { ...existing, ...patch } };
      });
    },
    [],
  );

  const tabs = useMemo(() => states.map(flatten), [states]);
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activity,
      setActivity,
      tabs,
      activeTabId,
      activeTab,
      openTab,
      navigate,
      closeTab,
      setActiveTab,
      updateTab,
      back,
      forward,
      reorderTabs,
      togglePinTab,
      closeOthers,
      closeAll,
      runOpen,
      setRunOpen,
      runLog,
      appendRunLog,
      clearRunLog,
      paletteOpen,
      setPaletteOpen,
      sidebarOpen,
      setSidebarOpen,
      autopilot,
      setAutopilot,
      conversations,
      ensureConversation,
      appendMessage,
      setConversationThinking,
      fileDrafts,
      setFileDraft,
    }),
    [
      activity,
      tabs,
      activeTabId,
      activeTab,
      openTab,
      navigate,
      closeTab,
      setActiveTab,
      updateTab,
      back,
      forward,
      reorderTabs,
      togglePinTab,
      closeOthers,
      closeAll,
      runOpen,
      runLog,
      appendRunLog,
      clearRunLog,
      paletteOpen,
      sidebarOpen,
      autopilot,
      setAutopilot,
      conversations,
      ensureConversation,
      appendMessage,
      setConversationThinking,
      fileDrafts,
      setFileDraft,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
