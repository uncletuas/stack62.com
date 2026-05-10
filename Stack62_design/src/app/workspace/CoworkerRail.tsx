import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  FileText,
  GitBranch,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../context/app-context";
import {
  coworkerChat,
  createCoworkerMemory,
  deleteCoworkerMemory,
  fetchAiRequests,
  fetchCoworker,
  fetchCoworkerConversations,
  fetchCoworkerMemories,
  fetchCoworkerMessages,
  fetchWorkflowRuns,
  updateCoworkerMemory,
  uploadFile,
  type AiChangeRequest,
  type Coworker,
  type CoworkerConversation,
  type CoworkerMemory,
  type CoworkerMemoryKind,
  type CoworkerMessage,
  type CoworkerRole,
  type StoredFile,
  type WorkflowRun,
} from "../lib/resources";
import { useWorkspace, type EditorTab } from "./workspace-context";

const ROLE_BADGE: Record<CoworkerRole, string> = {
  admin: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  manager: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  staff: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  reviewer: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  read_only: "border-slate-500/40 bg-slate-500/10 text-app-muted",
};

const POSITION_KEY = "stack62.coworkerLauncher.v2";
const FLASH_VISIBLE_MS = 8000;
const FLASH_INTERVAL_MS = 75_000; // 75s between flashes when idle.

type Position = { x: number; y: number };

interface ChatAttachment {
  id: string;
  filename: string;
  size: number;
  uploaded: StoredFile | null;
  uploading: boolean;
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function clamp(x: number, y: number): Position {
  const margin = 16;
  const maxX = Math.max(margin, window.innerWidth - 72);
  const maxY = Math.max(margin, window.innerHeight - 72);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin + 36, y), maxY),
  };
}
function loadPosition(): Position {
  const fallback: Position = {
    x: window.innerWidth - 96,
    y: window.innerHeight - 120,
  };
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return clamp(fallback.x, fallback.y);
    const p = JSON.parse(raw) as Position;
    return clamp(p.x, p.y);
  } catch {
    return clamp(fallback.x, fallback.y);
  }
}
function savePosition(p: Position) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

type PanelTab = "chat" | "memory" | "plans";

export function CoworkerRail() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, activeTab } = useWorkspace();

  const orgId = currentOrganization?.id ?? null;
  const workspaceId = currentWorkspace?.id ?? null;

  const [coworker, setCoworker] = useState<Coworker | null>(null);
  const [pending, setPending] = useState<AiChangeRequest[]>([]);
  const [waitingRuns, setWaitingRuns] = useState<WorkflowRun[]>([]);
  const [memories, setMemories] = useState<CoworkerMemory[]>([]);
  const [conversations, setConversations] = useState<CoworkerConversation[]>([]);
  const [conversationId, setConversationId] = useState<string>("default");
  const [messages, setMessages] = useState<CoworkerMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("chat");
  const [position, setPosition] = useState<Position>(() => loadPosition());

  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const flashTimerRef = useRef<{ visible: number | null; cycle: number | null }>({
    visible: null,
    cycle: null,
  });
  const dragRef = useRef({
    dragging: false,
    moved: false,
    pointerId: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  // ── Load coworker config ────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId || !workspaceId) {
      setCoworker(null);
      return;
    }
    let live = true;
    fetchCoworker(orgId, workspaceId)
      .then((c) => {
        if (live) setCoworker(c);
      })
      .catch(() => {
        if (live) setCoworker(null);
      });
    return () => {
      live = false;
    };
  }, [orgId, workspaceId]);

  // ── Pending plans + workflow approvals (refresh every 30s) ─────────────
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    const load = async () => {
      try {
        const [plans, runs] = await Promise.all([
          fetchAiRequests({
            organizationId: orgId,
            workspaceId: workspaceId ?? undefined,
            status: "pending",
          }),
          fetchWorkflowRuns({
            organizationId: orgId,
            workspaceId: workspaceId ?? undefined,
            status: "active",
          }),
        ]);
        if (!live) return;
        setPending(plans);
        setWaitingRuns(
          runs.filter((r) => r.status === "active" && !r.nextRunAt),
        );
      } catch {
        if (!live) return;
        setPending([]);
        setWaitingRuns([]);
      }
    };
    void load();
    const handle = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(handle);
    };
  }, [orgId, workspaceId]);

  // ── Memories ────────────────────────────────────────────────────────────
  const refreshMemories = useCallback(async () => {
    if (!orgId || !workspaceId) return;
    try {
      const next = await fetchCoworkerMemories({
        organizationId: orgId,
        workspaceId,
      });
      setMemories(next);
    } catch {
      setMemories([]);
    }
  }, [orgId, workspaceId]);
  useEffect(() => {
    void refreshMemories();
  }, [refreshMemories]);

  // ── Conversations list ──────────────────────────────────────────────────
  const refreshConversations = useCallback(async () => {
    if (!orgId || !workspaceId) return;
    try {
      const next = await fetchCoworkerConversations({
        organizationId: orgId,
        workspaceId,
      });
      setConversations(next);
    } catch {
      setConversations([]);
    }
  }, [orgId, workspaceId]);
  useEffect(() => {
    if (!open) return;
    void refreshConversations();
  }, [open, refreshConversations]);

  // ── Active conversation messages ────────────────────────────────────────
  useEffect(() => {
    if (!open || !orgId || !workspaceId) return;
    let live = true;
    fetchCoworkerMessages({
      organizationId: orgId,
      workspaceId,
      conversationId,
    })
      .then((next) => {
        if (live) setMessages(next);
      })
      .catch(() => {
        if (live) setMessages([]);
      });
    return () => {
      live = false;
    };
  }, [open, orgId, workspaceId, conversationId]);

  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open, tab]);

  // ── Periodic flash message: shows for 8s, hides, then re-flashes
  // FLASH_INTERVAL_MS later. Suppressed entirely while panel is open. ─────
  useEffect(() => {
    if (open) {
      if (flashTimerRef.current.visible) {
        window.clearTimeout(flashTimerRef.current.visible);
      }
      if (flashTimerRef.current.cycle) {
        window.clearTimeout(flashTimerRef.current.cycle);
      }
      setFlashMessage(null);
      return;
    }

    const showOne = () => {
      const text = pickFlashMessage(activeTab, coworker?.name ?? "Ada", {
        pendingCount: pending.length + waitingRuns.length,
        memoryCount: memories.length,
      });
      if (!text) {
        flashTimerRef.current.cycle = window.setTimeout(
          showOne,
          FLASH_INTERVAL_MS,
        );
        return;
      }
      setFlashMessage(text);
      flashTimerRef.current.visible = window.setTimeout(() => {
        setFlashMessage(null);
        flashTimerRef.current.cycle = window.setTimeout(
          showOne,
          FLASH_INTERVAL_MS,
        );
      }, FLASH_VISIBLE_MS);
    };

    // First flash a little after mount/tab change.
    flashTimerRef.current.cycle = window.setTimeout(showOne, 2000);
    return () => {
      if (flashTimerRef.current.visible) {
        window.clearTimeout(flashTimerRef.current.visible);
      }
      if (flashTimerRef.current.cycle) {
        window.clearTimeout(flashTimerRef.current.cycle);
      }
    };
  }, [
    open,
    activeTab?.kind,
    activeTab?.refId,
    coworker?.name,
    pending.length,
    waitingRuns.length,
    memories.length,
  ]);

  // ── Resize / Esc ────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => setPosition((cur) => clamp(cur.x, cur.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ── File attachments ───────────────────────────────────────────────────
  const onPickFiles = async (files: FileList | null) => {
    if (!orgId || !files || files.length === 0) return;
    const items: ChatAttachment[] = Array.from(files).map((file) => ({
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: file.name,
      size: file.size,
      uploaded: null,
      uploading: true,
      error: null,
    }));
    setAttachments((cur) => [...cur, ...items]);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const file = files[i];
      try {
        const stored = await uploadFile({
          file,
          organizationId: orgId,
          workspaceId: workspaceId ?? undefined,
          scope: "attachment",
        });
        setAttachments((cur) =>
          cur.map((a) =>
            a.id === item.id ? { ...a, uploading: false, uploaded: stored } : a,
          ),
        );
      } catch (err) {
        setAttachments((cur) =>
          cur.map((a) =>
            a.id === item.id
              ? {
                  ...a,
                  uploading: false,
                  error: (err as Error).message ?? "Upload failed",
                }
              : a,
          ),
        );
      }
    }
  };
  const removeAttachment = (id: string) =>
    setAttachments((cur) => cur.filter((a) => a.id !== id));

  // ── Send message ────────────────────────────────────────────────────────
  const send = async () => {
    if (!orgId || !workspaceId) return;
    const prompt = draft.trim();
    const ready = attachments.filter((a) => a.uploaded && !a.error);
    if ((!prompt && ready.length === 0) || sending) return;
    if (attachments.some((a) => a.uploading)) return;
    setSending(true);
    setDraft("");
    const attachmentLines = ready.map(
      (a) =>
        `[Attached: ${a.uploaded!.filename} · ${formatBytes(a.uploaded!.size)} · file:${a.uploaded!.id}]`,
    );
    const fullPrompt =
      attachmentLines.length > 0
        ? `${attachmentLines.join("\n")}${prompt ? `\n\n${prompt}` : ""}`
        : prompt;
    const visibleContent = prompt
      ? prompt
      : ready.map((a) => a.uploaded!.filename).join(", ");
    const optimistic: CoworkerMessage = {
      id: `tmp-${Date.now()}`,
      organizationId: orgId,
      workspaceId,
      conversationId,
      actorUserId: null,
      role: "user",
      content: visibleContent,
      toolCalls: null,
      metadata: { attachments: ready.map((a) => a.uploaded!.id) },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setAttachments([]);
    try {
      const result = await coworkerChat({
        organizationId: orgId,
        workspaceId,
        prompt: fullPrompt,
        conversationId,
      });
      // Server returns the canonical conversationId — adopt it (matters when
      // we just created a "new chat" with a temporary client-side id).
      if (result.conversationId && result.conversationId !== conversationId) {
        setConversationId(result.conversationId);
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        optimistic,
        result.message,
      ]);
      void refreshConversations();
    } catch (err) {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimistic.id),
        optimistic,
        {
          ...optimistic,
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `Failed: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  // ── Open via flash click → also focus chat tab ─────────────────────────
  const openFromFlash = () => {
    setFlashMessage(null);
    setTab("chat");
    setOpen(true);
  };
  const newChat = () => {
    setConversationId(`c-${Date.now().toString(36)}`);
    setMessages([]);
    setShowHistory(false);
    setTab("chat");
  };
  const switchConversation = (id: string) => {
    setConversationId(id);
    setShowHistory(false);
    setTab("chat");
  };

  if (!orgId || !workspaceId) return null;

  const role = (coworker?.role ?? "staff") as CoworkerRole;
  const name = coworker?.name ?? "Ada";
  const pendingCount = pending.length + waitingRuns.length;

  return (
    <>
      {/* The Bubble */}
      <button
        ref={launcherRef}
        type="button"
        onPointerDown={(event) => {
          dragRef.current = {
            dragging: true,
            moved: false,
            pointerId: event.pointerId,
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag.dragging || drag.pointerId !== event.pointerId) return;
          const next = clamp(
            event.clientX - drag.offsetX,
            event.clientY - drag.offsetY,
          );
          if (
            Math.abs(next.x - position.x) > 2 ||
            Math.abs(next.y - position.y) > 2
          ) {
            drag.moved = true;
          }
          setPosition(next);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag.pointerId === event.pointerId) {
            drag.dragging = false;
            savePosition(position);
            if (!drag.moved) {
              setFlashMessage(null);
              setOpen((cur) => !cur);
            }
          }
        }}
        onPointerCancel={() => {
          dragRef.current.dragging = false;
          savePosition(position);
        }}
        className="fixed z-[60] grid h-14 w-14 touch-none select-none place-items-center rounded-full text-cyan-100 outline-none transition"
        style={{ left: position.x, top: position.y }}
        title={`${name} (${role}) — drag to move, tap to open`}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(34,211,238,0.55), rgba(167,139,250,0.45), rgba(110,231,183,0.45), rgba(34,211,238,0.55))",
            animation: "stack62-spin 6s linear infinite",
            filter: "blur(6px)",
            opacity: 0.85,
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[-4px] rounded-full"
          style={{
            boxShadow:
              "0 0 28px 4px rgba(34,211,238,0.25), 0 0 60px 12px rgba(167,139,250,0.18)",
            animation: "stack62-pulse 2.6s ease-in-out infinite",
          }}
        />
        <span className="relative grid h-12 w-12 place-items-center rounded-full border border-cyan-300/40 bg-slate-950/95 backdrop-blur">
          <Bot className="h-5 w-5" />
          <span
            className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-slate-950 ${
              pendingCount > 0
                ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.85)]"
                : "bg-emerald-400 shadow-[0_0_8px_rgba(110,231,183,0.7)]"
            }`}
          />
          {pendingCount > 0 && (
            <span className="absolute -bottom-1 -right-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950 shadow-[0_0_10px_rgba(251,191,36,0.5)]">
              {pendingCount}
            </span>
          )}
        </span>
      </button>

      {/* Periodic flash message — clickable, no buttons */}
      {!open && flashMessage && (
        <FlashBubble
          position={position}
          name={name}
          message={flashMessage}
          pendingCount={pendingCount}
          onOpen={openFromFlash}
        />
      )}

      {/* Genie Panel */}
      {open && (
        <GeniePanel
          position={position}
          name={name}
          role={role}
          tab={tab}
          setTab={setTab}
          pending={pending}
          waitingRuns={waitingRuns}
          memories={memories}
          messages={messages}
          conversations={conversations}
          conversationId={conversationId}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
          conversationRef={conversationRef}
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onClose={() => setOpen(false)}
          onSend={() => void send()}
          onNewChat={newChat}
          onSwitchConversation={switchConversation}
          onOpenPlan={(req) =>
            navigate({
              kind: "plan",
              title: req.summary ?? "Plan",
              refId: req.id,
            })
          }
          onOpenRun={(run) =>
            navigate({
              kind: "workflow",
              title: `Workflow run · ${run.currentStepKey ?? "?"}`,
              refId: run.id,
            })
          }
          onMemoryChange={() => void refreshMemories()}
          orgId={orgId}
          workspaceId={workspaceId}
          attachments={attachments}
          onPickFiles={onPickFiles}
          onRemoveAttachment={removeAttachment}
        />
      )}

      <style>{`
        @keyframes stack62-spin { to { transform: rotate(360deg); } }
        @keyframes stack62-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(1.06); }
        }
        @keyframes stack62-pop {
          0%   { opacity: 0; transform: translateY(6px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0)   scale(1);    }
        }
        @keyframes stack62-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function FlashBubble({
  position,
  name,
  message,
  pendingCount,
  onOpen,
}: {
  position: Position;
  name: string;
  message: string;
  pendingCount: number;
  onOpen: () => void;
}) {
  const placeLeft = position.x > window.innerWidth - 360;
  const top = Math.max(16, position.y - 12);
  const style: React.CSSProperties = placeLeft
    ? { right: window.innerWidth - position.x + 12, top }
    : { left: position.x + 72, top };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed z-[59] max-w-[320px] rounded-2xl border border-cyan-400/30 bg-slate-950/90 px-3 py-2 text-left text-xs text-app shadow-[0_8px_30px_rgba(34,211,238,0.18)] backdrop-blur transition hover:border-cyan-300/60 hover:bg-app-surface"
      style={{ ...style, animation: "stack62-pop 220ms ease-out" }}
      title="Open chat"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-500/20 text-cyan-200">
          <MessageSquare className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-cyan-300">
            {name}
            {pendingCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] text-amber-200">
                {pendingCount} waiting
              </span>
            )}
          </p>
          <p className="mt-0.5 leading-relaxed text-app">{message}</p>
        </div>
      </div>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

interface GeniePanelProps {
  position: Position;
  name: string;
  role: CoworkerRole;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  pending: AiChangeRequest[];
  waitingRuns: WorkflowRun[];
  memories: CoworkerMemory[];
  messages: CoworkerMessage[];
  conversations: CoworkerConversation[];
  conversationId: string;
  showHistory: boolean;
  setShowHistory: (next: boolean) => void;
  conversationRef: React.MutableRefObject<HTMLDivElement | null>;
  draft: string;
  setDraft: (next: string) => void;
  sending: boolean;
  onClose: () => void;
  onSend: () => void;
  onNewChat: () => void;
  onSwitchConversation: (id: string) => void;
  onOpenPlan: (req: AiChangeRequest) => void;
  onOpenRun: (run: WorkflowRun) => void;
  onMemoryChange: () => void;
  orgId: string;
  workspaceId: string;
  attachments: ChatAttachment[];
  onPickFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
}

function GeniePanel({
  position,
  name,
  role,
  tab,
  setTab,
  pending,
  waitingRuns,
  memories,
  messages,
  conversations,
  conversationId,
  showHistory,
  setShowHistory,
  conversationRef,
  draft,
  setDraft,
  sending,
  onClose,
  onSend,
  onNewChat,
  onSwitchConversation,
  onOpenPlan,
  onOpenRun,
  onMemoryChange,
  orgId,
  workspaceId,
  attachments,
  onPickFiles,
  onRemoveAttachment,
}: GeniePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const panelW = 380;
  const panelH = 600;
  const placeLeft = position.x > window.innerWidth - panelW - 24;
  const left = placeLeft
    ? Math.max(16, position.x - panelW - 16)
    : position.x + 80;
  const top = Math.max(
    16,
    Math.min(position.y - 80, window.innerHeight - panelH - 16),
  );

  const total = pending.length + waitingRuns.length;
  const activeConversation = conversations.find(
    (c) => c.conversationId === conversationId,
  );

  return (
    <>
      <div
        className="fixed inset-0 z-[58] bg-slate-950/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-cyan-400/20 text-app shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        style={{
          left,
          top,
          width: panelW,
          height: panelH,
          animation: "stack62-pop 240ms ease-out",
          background:
            "linear-gradient(160deg, rgba(15,23,42,0.96) 0%, rgba(8,47,73,0.92) 50%, rgba(30,18,57,0.96) 100%)",
        }}
      >
        {/* Header */}
        <header className="relative shrink-0 border-b border-white/5 px-3 py-2.5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(34,211,238,0.6), rgba(167,139,250,0.5), transparent)",
              backgroundSize: "200% 100%",
              animation: "stack62-shimmer 4s linear infinite",
            }}
          />
          <div className="flex items-center gap-2.5">
            <span className="relative grid h-9 w-9 place-items-center rounded-full border border-cyan-300/40 bg-slate-950/80">
              <Bot className="h-4 w-4 text-cyan-200" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">
                {name}
              </p>
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-app-muted">
                <span className={`rounded-full border px-1.5 py-0.5 ${ROLE_BADGE[role]}`}>
                  {role.replace("_", " ")}
                </span>
                <span className="text-app-subtle">· coworker</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-app-muted hover:bg-white/5"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs — Chat first, no Hints */}
          <nav className="mt-2.5 flex gap-1 rounded-full border border-white/5 bg-slate-950/60 p-0.5 text-[11px]">
            <TabButton
              active={tab === "chat"}
              onClick={() => setTab("chat")}
              icon={MessageSquare}
              label="Chat"
            />
            <TabButton
              active={tab === "plans"}
              onClick={() => setTab("plans")}
              icon={GitBranch}
              label={`Plans${total ? ` · ${total}` : ""}`}
              accent={total > 0}
            />
            <TabButton
              active={tab === "memory"}
              onClick={() => setTab("memory")}
              icon={Brain}
              label={`Memory${memories.length ? ` · ${memories.length}` : ""}`}
            />
          </nav>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "chat" && (
            <>
              {/* Chat history toolbar */}
              <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1 rounded-full border border-white/5 bg-slate-950/60 px-2 py-0.5 text-[11px] text-app-muted hover:bg-white/5"
                  title="Chat history"
                >
                  <History className="h-3 w-3" />
                  <span>History</span>
                </button>
                <p className="min-w-0 flex-1 truncate text-[11px] text-app-subtle">
                  {activeConversation?.title ?? "New chat"}
                </p>
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex items-center gap-1 rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 px-2 py-0.5 text-[11px] font-semibold text-slate-950"
                  title="New chat"
                >
                  <Plus className="h-3 w-3" />
                  <span>New</span>
                </button>
              </div>

              {showHistory ? (
                <ChatHistory
                  conversations={conversations}
                  activeId={conversationId}
                  onPick={onSwitchConversation}
                  onClose={() => setShowHistory(false)}
                />
              ) : (
                <div
                  ref={conversationRef}
                  className="min-h-0 flex-1 overflow-y-auto p-3 text-xs"
                >
                  {messages.length === 0 ? (
                    <p className="text-app-subtle">
                      Hi — I'm <span className="text-app">{name}</span>.
                      Ask me anything about this workspace, and I'll act using
                      your connected tools.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {messages.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} />
                      ))}
                      {sending && (
                        <li className="flex items-center gap-2 text-[11px] text-app-subtle">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {name} is thinking...
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "plans" && (
            <PlansTab
              pending={pending}
              waitingRuns={waitingRuns}
              onOpenPlan={onOpenPlan}
              onOpenRun={onOpenRun}
            />
          )}

          {tab === "memory" && (
            <MemoryTab
              memories={memories}
              orgId={orgId}
              workspaceId={workspaceId}
              onChange={onMemoryChange}
            />
          )}
        </div>

        {/* Composer (visible on chat tab only) */}
        {tab === "chat" && !showHistory && (
          <footer className="shrink-0 border-t border-white/5 bg-slate-950/40 p-2">
            {attachments.length > 0 && (
              <ul className="mb-1.5 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
                      a.error
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                        : a.uploading
                        ? "border-slate-500/30 bg-slate-500/10 text-app-muted"
                        : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                    }`}
                    title={a.error ?? `${a.filename} · ${formatBytes(a.size)}`}
                  >
                    {a.uploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    <span className="max-w-[140px] truncate">{a.filename}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(a.id)}
                      className="rounded-full p-0.5 hover:bg-white/10"
                      title="Remove"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/5 bg-slate-950/70 text-app-muted hover:border-cyan-400/40 hover:text-cyan-200"
                title="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                placeholder={
                  attachments.length > 0
                    ? `Add a note about ${attachments.length} file${
                        attachments.length === 1 ? "" : "s"
                      }… (optional)`
                    : `Ask ${name} anything…`
                }
                rows={2}
                className="min-h-[44px] w-full resize-none rounded-xl border border-white/5 bg-slate-950/70 px-2.5 py-1.5 text-xs text-app placeholder:text-app-faint focus:border-cyan-400/40 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={onSend}
                disabled={
                  sending ||
                  attachments.some((a) => a.uploading) ||
                  (!draft.trim() && attachments.filter((a) => a.uploaded).length === 0)
                }
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.35)] disabled:opacity-40"
                title="Send"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </footer>
        )}
      </aside>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1 transition ${
        active
          ? "bg-gradient-to-br from-cyan-500/30 to-violet-500/30 text-slate-50 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]"
          : accent
          ? "text-amber-200 hover:bg-white/5"
          : "text-app-muted hover:bg-white/5"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

/* ── Chat history ──────────────────────────────────────────────────────── */

function ChatHistory({
  conversations,
  activeId,
  onPick,
  onClose,
}: {
  conversations: CoworkerConversation[];
  activeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-1 border-b border-white/5 px-3 py-1.5 text-[11px] text-app-subtle">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-0.5 hover:bg-white/5"
          title="Back"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span>Chat history</span>
        <span className="ml-auto text-[10px] text-app-faint">
          {conversations.length} conversation{conversations.length === 1 ? "" : "s"}
        </span>
      </div>
      {conversations.length === 0 ? (
        <p className="p-3 text-xs text-app-subtle">
          No prior conversations yet. Start a new chat to begin.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {conversations.map((c) => (
            <li key={c.conversationId}>
              <button
                type="button"
                onClick={() => onPick(c.conversationId)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition ${
                  c.conversationId === activeId
                    ? "bg-cyan-500/10 text-app"
                    : "hover:bg-white/5"
                }`}
              >
                <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-app">{c.title}</p>
                  <p className="text-[10px] text-app-faint">
                    {c.messageCount} message
                    {c.messageCount === 1 ? "" : "s"} ·{" "}
                    {timeAgo(c.lastAt)} ago
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Plans tab ─────────────────────────────────────────────────────────── */

function PlansTab({
  pending,
  waitingRuns,
  onOpenPlan,
  onOpenRun,
}: {
  pending: AiChangeRequest[];
  waitingRuns: WorkflowRun[];
  onOpenPlan: (req: AiChangeRequest) => void;
  onOpenRun: (run: WorkflowRun) => void;
}) {
  if (pending.length === 0 && waitingRuns.length === 0) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-xs text-app-subtle">
        <div>
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-400" />
          <p className="mt-2">Nothing waiting on you. The system is calm.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 overflow-y-auto p-3 text-xs">
      {pending.length > 0 && (
        <section>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-amber-300">
            Plans to approve
          </p>
          <ul className="space-y-1">
            {pending.map((req) => (
              <li key={req.id}>
                <button
                  type="button"
                  onClick={() => onOpenPlan(req)}
                  className="flex w-full items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-left hover:bg-amber-500/10"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <span className="min-w-0 flex-1 truncate text-amber-100">
                    {req.summary ?? req.prompt.slice(0, 60)}
                  </span>
                  <span className="shrink-0 rounded-full border border-amber-500/30 px-1.5 py-0.5 text-[9px] uppercase text-amber-300">
                    {req.riskLevel ?? "?"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {waitingRuns.length > 0 && (
        <section>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300">
            Workflow approvals
          </p>
          <ul className="space-y-1">
            {waitingRuns.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onOpenRun(run)}
                  className="flex w-full items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1.5 text-left hover:bg-violet-500/10"
                >
                  <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                  <span className="min-w-0 flex-1 truncate text-violet-100">
                    Workflow at "{run.currentStepKey ?? "?"}"
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ── Memory tab (with edit + delete) ───────────────────────────────────── */

function MemoryTab({
  memories,
  orgId,
  workspaceId,
  onChange,
}: {
  memories: CoworkerMemory[];
  orgId: string;
  workspaceId: string;
  onChange: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<CoworkerMemoryKind>("preference");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingKind, setEditingKind] = useState<CoworkerMemoryKind>("preference");

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      await createCoworkerMemory({
        organizationId: orgId,
        workspaceId,
        kind,
        text,
      });
      setDraft("");
      onChange();
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteCoworkerMemory(id);
      onChange();
    } catch {
      /* ignore */
    }
  };

  const startEdit = (m: CoworkerMemory) => {
    setEditingId(m.id);
    setEditingText(m.text);
    setEditingKind(m.kind);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    const text = editingText.trim();
    if (!text) return;
    try {
      await updateCoworkerMemory(editingId, { text, kind: editingKind });
      setEditingId(null);
      onChange();
    } catch {
      /* ignore */
    }
  };

  // Group facts vs preferences vs episodes for display.
  const groups: Array<[CoworkerMemoryKind, string]> = [
    ["preference", "Preferences"],
    ["fact", "Facts"],
    ["episode", "Episodes"],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Add new */}
      <div className="shrink-0 space-y-1.5 border-b border-white/5 p-3">
        <div className="flex gap-1.5">
          {(["fact", "preference", "episode"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                kind === k
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-white/5 bg-slate-950/40 text-app-subtle hover:bg-white/5"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={`Teach me a ${kind}...`}
            className="min-w-0 flex-1 rounded-lg border border-white/5 bg-slate-950/60 px-2 py-1 text-[11px] placeholder:text-app-faint focus:border-cyan-400/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!draft.trim() || adding}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-500/90 text-cyan-950 hover:bg-cyan-400 disabled:opacity-50"
            title="Add"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {memories.length === 0 ? (
          <p className="text-app-subtle">
            Nothing remembered yet. Teach me a fact ("we use Slack for ops"), a
            preference ("default to weekly cadence"), or an episode ("hired Maya
            on Mar 5"). Memories are scoped to this workspace.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map(([groupKind, groupTitle]) => {
              const items = memories.filter((m) => m.kind === groupKind);
              if (items.length === 0) return null;
              return (
                <section key={groupKind}>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-app-faint">
                    {groupTitle} · {items.length}
                  </p>
                  <ul className="space-y-1.5">
                    {items.map((m) => (
                      <li
                        key={m.id}
                        className="group rounded-lg border border-white/5 bg-slate-950/40 p-2"
                      >
                        {editingId === m.id ? (
                          <div className="space-y-1.5">
                            <div className="flex gap-1">
                              {(["fact", "preference", "episode"] as const).map(
                                (k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() => setEditingKind(k)}
                                    className={`flex-1 rounded-full border px-1 py-0.5 text-[9px] uppercase tracking-wide ${
                                      editingKind === k
                                        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                                        : "border-white/5 bg-slate-950/40 text-app-subtle hover:bg-white/5"
                                    }`}
                                  >
                                    {k}
                                  </button>
                                ),
                              )}
                            </div>
                            <textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              rows={2}
                              className="w-full resize-none rounded-lg border border-cyan-500/30 bg-slate-950/60 px-2 py-1 text-[11px] focus:border-cyan-400/60 focus:outline-none"
                              autoFocus
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void saveEdit()}
                                className="rounded-lg bg-cyan-500/90 px-2 py-0.5 text-[10px] font-semibold text-cyan-950 hover:bg-cyan-400"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-lg px-2 py-0.5 text-[10px] text-app-subtle hover:bg-white/5"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start gap-2">
                              <span
                                className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${
                                  m.kind === "fact"
                                    ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
                                    : m.kind === "preference"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                                }`}
                              >
                                {m.kind}
                              </span>
                              <p className="min-w-0 flex-1 text-app">
                                {m.text}
                              </p>
                              <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => startEdit(m)}
                                  title="Edit"
                                  className="rounded p-0.5 hover:bg-white/5"
                                >
                                  <Edit3 className="h-3 w-3 text-cyan-300" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void remove(m.id)}
                                  title="Forget"
                                  className="rounded p-0.5 hover:bg-white/5"
                                >
                                  <Trash2 className="h-3 w-3 text-rose-400 hover:text-rose-300" />
                                </button>
                              </div>
                            </div>
                            <p className="mt-1 text-[10px] text-app-faint">
                              {m.source} ·{" "}
                              {new Date(m.updatedAt).toLocaleDateString()}
                            </p>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Message bubble ────────────────────────────────────────────────────── */

function MessageBubble({ msg }: { msg: CoworkerMessage }) {
  const isUser = msg.role === "user";
  const tools = useMemo(
    () =>
      Array.isArray(msg.toolCalls)
        ? (msg.toolCalls as Array<Record<string, unknown>>)
        : [],
    [msg.toolCalls],
  );
  const tier =
    msg.metadata && typeof msg.metadata === "object"
      ? ((msg.metadata as Record<string, unknown>).routerTier as
          | number
          | null
          | undefined)
      : null;
  const tierMeta = tierLabel(tier);
  return (
    <li
      className={`max-w-[88%] rounded-2xl px-2.5 py-1.5 text-xs ${
        isUser
          ? "ml-auto bg-gradient-to-br from-cyan-500/30 to-violet-500/20 text-cyan-50"
          : "mr-auto border border-white/5 bg-slate-950/60 text-app"
      }`}
    >
      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
      {(!isUser && (tierMeta || tools.length > 0)) && (
        <div className="mt-1 flex items-center gap-1.5 border-t border-white/5 pt-1 text-[10px] text-app-subtle">
          {tierMeta && (
            <span
              className={`rounded-full border px-1.5 py-0.5 ${tierMeta.className}`}
              title={tierMeta.title}
            >
              {tierMeta.label}
            </span>
          )}
          {tools.length > 0 && (
            <span className="truncate">
              {tools.map((t) => String(t.name ?? t.tool ?? "tool")).join(" · ")}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function tierLabel(tier: number | null | undefined) {
  if (tier === 0) {
    return {
      label: "🟢 instant",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      title: "Tier 0 — deterministic, no model used",
    };
  }
  if (tier === 1) {
    return {
      label: "🔵 local",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      title: "Tier 1 — local small model (Ollama)",
    };
  }
  if (tier === 2) {
    return {
      label: "🟡 mini",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
      title: "Tier 2 — cloud mini model",
    };
  }
  if (tier === 3) {
    return {
      label: "🔴 high",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      title: "Tier 3 — full reasoning model",
    };
  }
  return null;
}

/* ── Flash message catalog ─────────────────────────────────────────────── */

function pickFlashMessage(
  tab: EditorTab | null,
  name: string,
  ctx: { pendingCount: number; memoryCount: number },
): string | null {
  const pool: string[] = [];
  if (ctx.pendingCount > 0) {
    pool.push(
      `${ctx.pendingCount} item${ctx.pendingCount === 1 ? "" : "s"} need your review.`,
    );
  }
  const kind = tab?.kind ?? "welcome";
  switch (kind) {
    case "welcome":
      pool.push(
        `Want me to draft a starter system from a sentence?`,
        `I can summarize what changed across your workspace this week.`,
      );
      break;
    case "system":
      pool.push(
        `On this system I can add a module, draft a workflow, or audit changes.`,
        `Want a Plan that adds a status field across the main entity?`,
      );
      break;
    case "module":
      pool.push(
        `Need sample records to test this module? I can draft 5.`,
        `I can propose a kanban view based on the field shape.`,
      );
      break;
    case "record":
      pool.push(
        `Want me to draft a follow-up email about this record?`,
        `I can fill the missing fields based on context.`,
      );
      break;
    case "workflow":
      pool.push(
        `Want me to add a coworker step that drafts the notification?`,
        `I can simulate a run and report what breaks.`,
      );
      break;
    case "document":
      pool.push(
        `I can rewrite this with a TL;DR at the top.`,
        `Want me to push this to Google Drive as a Doc?`,
      );
      break;
    case "file":
      pool.push(
        `Want me to extract structured data from this file into a record?`,
      );
      break;
    case "plan":
      pool.push(
        `I can explain the highest-risk change in plain words.`,
        `Want a safe partial-approve subset for this plan?`,
      );
      break;
    case "tools":
      pool.push(
        `Once Gmail is connected, ask me "search Gmail for invoices last week".`,
        `Connect QuickBooks and I can list invoices straight in chat.`,
      );
      break;
    default:
      pool.push(`${name} is here. Ask me anything.`);
      break;
  }
  if (ctx.memoryCount === 0) {
    pool.push(
      `If you tell me a preference once, I'll remember it. Try "always weekly cadence".`,
    );
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function timeAgo(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
