import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  FileText,
  GitBranch,
  Hash,
  History,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  Video,
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
import { roomsApi, type RoomDto } from "../lib/dms-resources";
import { CoworkerFace } from "./CoworkerFace";

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

/**
 * Anchor presets for the floating launcher. Used by the "move to …"
 * command parser: the user types or speaks "go to the bottom right"
 * and we snap the launcher there with a transition.
 */
type Anchor =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

function anchorPosition(anchor: Anchor): Position {
  const margin = 24;
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (anchor) {
    case "top-left":
      return { x: margin, y: margin + 48 };
    case "top-right":
      return { x: w - 72 - margin, y: margin + 48 };
    case "bottom-left":
      return { x: margin, y: h - 72 - margin };
    case "bottom-right":
      return { x: w - 72 - margin, y: h - 72 - margin };
    case "center":
    default:
      return { x: w / 2 - 36, y: h / 2 - 36 };
  }
}

/**
 * Parse a free-form command from the chat composer or voice into a
 * launcher action. Returns null when the prompt isn't a movement
 * command — caller falls back to the normal LLM round-trip.
 *
 * Recognised:
 *   - "move/go to (the) top/bottom + left/right"
 *   - "move to the center"
 *   - "go left/right/up/down"
 *   - "hide/minimize/close"
 *   - "show/open"
 */
function parseLauncherCommand(
  raw: string,
): { kind: "anchor"; anchor: Anchor } | { kind: "close" } | { kind: "open" } | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  // Only match when the *whole* utterance is a command — we don't
  // want "tell sarah to move the deadline to the right side of the
  // table" to reposition the rail.
  const moveRe =
    /^(?:hey\s+)?(?:stack62|coworker)?[,\s]*\b(?:please\s+)?(?:go|move|jump|fly|hop|teleport|run)\s+(?:to\s+)?(?:the\s+)?(top|upper|bottom|lower)?[\s-]*?(left|right|center|middle)?(?:\s+side|\s+corner)?$/;
  const m = text.match(moveRe);
  if (m) {
    const v = m[1] === "upper" ? "top" : m[1] === "lower" ? "bottom" : m[1];
    const h = m[2] === "middle" ? "center" : m[2];
    const anchor: Anchor =
      h === "center"
        ? "center"
        : v && h
          ? (`${v}-${h}` as Anchor)
          : v === "top"
            ? "top-right"
            : v === "bottom"
              ? "bottom-right"
              : h === "left"
                ? "bottom-left"
                : "bottom-right";
    return { kind: "anchor", anchor };
  }
  if (/^(?:hide|minimi[sz]e|go\s+away|close\s+(?:yourself|coworker))$/.test(text)) {
    return { kind: "close" };
  }
  if (/^(?:show|open|come\s+(?:back|here))$/.test(text)) {
    return { kind: "open" };
  }
  return null;
}

/**
 * Text-to-speech helper. Uses the built-in Web Speech Synthesis API
 * so the Coworker can actually speak its replies — the start of the
 * "robot face that talks" vision.
 *
 * Quietly no-ops on browsers without speech support (rare).
 */
function speak(text: string, opts: { rate?: number; pitch?: number } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text?.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1.0;
    u.lang = navigator.language || "en-US";
    window.speechSynthesis.speak(u);
  } catch {
    /* speech engine missing — ignore */
  }
}

function stopSpeaking() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

const VOICE_PREF_KEY = "stack62.coworker.voice";
function readVoicePreference(): boolean {
  try {
    return localStorage.getItem(VOICE_PREF_KEY) === "on";
  } catch {
    return false;
  }
}
function writeVoicePreference(on: boolean) {
  try {
    localStorage.setItem(VOICE_PREF_KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

type PanelTab = "coworker" | "team" | "rooms";

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
  const [tab, setTab] = useState<PanelTab>("coworker");
  const [position, setPosition] = useState<Position>(() => loadPosition());
  /** True while the speech synthesizer is actively vocalising. Used to
   * animate the Coworker face (mouth moves) so the bot looks alive. */
  const [speaking, setSpeaking] = useState(false);
  /** Voice conversation mode — continuous loop where the rail listens,
   * sends the recognised utterance, speaks the reply, then re-listens.
   * Toggled by the morphing send/voice button in the composer. */
  const [voiceConversation, setVoiceConversation] = useState(false);
  /** Live multimodal mode — periodic webcam snapshots get sent so the
   * Coworker can react to what it sees. Toggled separately. */
  const [liveMode, setLiveMode] = useState(false);

  /**
   * Snap the floating launcher to one of the four corners / center.
   * Wired to the "move to the bottom right"-style commands.
   */
  const moveToAnchor = useCallback((anchor: Anchor) => {
    const next = clamp(
      anchorPosition(anchor).x,
      anchorPosition(anchor).y,
    );
    setPosition(next);
    savePosition(next);
  }, []);

  // ── Voice conversation mode ────────────────────────────────────────────
  // A continuous loop: listen → recognise → send → speak reply → repeat.
  // Like a hands-free phone call with the Coworker.
  type SpeechWindow = Window & {
    SpeechRecognition?: typeof window.SpeechRecognition;
    webkitSpeechRecognition?: typeof window.SpeechRecognition;
  };
  const recognitionRef = useRef<InstanceType<
    NonNullable<typeof window.SpeechRecognition>
  > | null>(null);
  const voiceConversationRef = useRef(false);
  voiceConversationRef.current = voiceConversation;

  const stopVoiceConversation = useCallback(() => {
    setVoiceConversation(false);
    voiceConversationRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    stopSpeaking();
  }, []);

  const startVoiceConversation = useCallback(() => {
    const Recognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition ??
      null;
    if (!Recognition) {
      // Browser doesn't support speech recognition — fall back to a
      // friendly nudge instead of silently failing.
      window.alert(
        "Voice mode needs the Web Speech API, which isn't available in this browser. Try Chrome, Edge, or Brave.",
      );
      return;
    }
    setVoiceConversation(true);
    voiceConversationRef.current = true;
  }, []);

  /**
   * The actual listen/send/speak cycle. Driven by an effect so it
   * restarts automatically after each spoken reply.
   *
   * Stop conditions: voiceConversationRef goes false (user tapped
   * stop), recognition errors out twice in a row, or the rail closes.
   */
  useEffect(() => {
    if (!voiceConversation) return;
    let cancelled = false;
    const Recognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition ??
      null;
    if (!Recognition) return;

    const cycle = async () => {
      while (!cancelled && voiceConversationRef.current) {
        // Wait until we're not speaking, so we don't pick up our own
        // synthesized voice through the microphone.
        if (speaking) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        try {
          const transcript = await new Promise<string>((resolve, reject) => {
            const r = new Recognition();
            recognitionRef.current = r;
            r.continuous = false;
            r.interimResults = false;
            r.lang = navigator.language || "en-US";
            let finalText = "";
            r.onresult = (event: SpeechRecognitionEvent) => {
              for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal && result[0]?.transcript) {
                  finalText += result[0].transcript;
                }
              }
            };
            r.onend = () => resolve(finalText.trim());
            r.onerror = (event: SpeechRecognitionErrorEvent) => {
              if (event.error === "no-speech") {
                resolve("");
              } else {
                reject(new Error(event.error));
              }
            };
            try {
              r.start();
            } catch {
              resolve("");
            }
          });
          if (cancelled || !voiceConversationRef.current) break;
          if (!transcript) continue;
          // Push as if the user typed and hit send. We reuse send()
          // by setting the draft + invoking it; send() will speak the
          // reply through speakReply() which sets `speaking`.
          setDraft(transcript);
          await new Promise((r) => setTimeout(r, 30));
          await send();
        } catch {
          // Silent — recognition can error on permission denies; we
          // just exit the loop so the user isn't trapped.
          if (!cancelled) stopVoiceConversation();
          return;
        }
      }
    };
    void cycle();
    return () => {
      cancelled = true;
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceConversation]);

  // ── Live multimodal (webcam) mode ──────────────────────────────────────
  // Periodically snapshot the webcam and ship the frame to the Coworker
  // so it can react to what it sees. Not true streaming — that needs a
  // realtime multimodal endpoint — but feels conversational.
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveTimerRef = useRef<number | null>(null);

  const stopLive = useCallback(() => {
    setLiveMode(false);
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((t) => t.stop());
      liveStreamRef.current = null;
    }
  }, []);

  const toggleLiveMode = useCallback(async () => {
    if (liveMode) {
      stopLive();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      window.alert(
        "Live mode needs a webcam. Your browser doesn't expose camera access.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: false,
      });
      liveStreamRef.current = stream;
      setLiveMode(true);
      // Capture one snapshot every 6 seconds. The Coworker receives a
      // text prompt like "[live frame] describe what you see briefly."
      // The frame itself flows in as an attachment via the existing
      // upload path so the vision model on the server can read it.
      liveTimerRef.current = window.setInterval(async () => {
        try {
          const track = stream.getVideoTracks()[0];
          if (!track) return;
          const imageCapture =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).ImageCapture &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            new (window as any).ImageCapture(track);
          let blob: Blob | null = null;
          if (imageCapture?.takePhoto) {
            blob = await imageCapture.takePhoto();
          } else {
            // Fallback: draw the current video frame onto a canvas.
            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            await video.play();
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")?.drawImage(video, 0, 0);
            blob = await new Promise<Blob | null>((r) =>
              canvas.toBlob(r, "image/jpeg", 0.85),
            );
            video.pause();
          }
          if (!blob) return;
          const file = new File([blob], `live-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          onPickFiles({
            length: 1,
            0: file,
            item: () => file,
          } as unknown as FileList);
        } catch {
          /* one bad frame shouldn't kill the loop */
        }
      }, 6000);
    } catch (err) {
      window.alert(
        "Couldn't access the camera: " +
          (err instanceof Error ? err.message : "unknown error"),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, stopLive]);

  // Cleanup on unmount.
  useEffect(() => () => stopLive(), [stopLive]);

  /**
   * Wraps the free speak() helper with lifecycle hooks so we can
   * animate the Coworker face while it's vocalising. Returns a promise
   * that resolves when speaking ends so the voice-conversation loop
   * can chain into the next listen cycle.
   */
  const speakReply = useCallback(
    (text: string): Promise<void> =>
      new Promise((resolve) => {
        if (!text?.trim() || !("speechSynthesis" in window)) {
          resolve();
          return;
        }
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.05;
          utterance.pitch = 1.0;
          utterance.lang = navigator.language || "en-US";
          utterance.onstart = () => setSpeaking(true);
          utterance.onend = () => {
            setSpeaking(false);
            resolve();
          };
          utterance.onerror = () => {
            setSpeaking(false);
            resolve();
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          setSpeaking(false);
          resolve();
        }
      }),
    [],
  );

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

    // Intercept movement / minimize / show commands locally — no
    // need to round-trip to the LLM for "go to the bottom right".
    const command = ready.length === 0 ? parseLauncherCommand(prompt) : null;
    if (command) {
      setDraft("");
      if (command.kind === "anchor") {
        moveToAnchor(command.anchor);
        if (voiceConversation) void speakReply(`Moving to ${command.anchor.replace("-", " ")}.`);
      } else if (command.kind === "close") {
        setOpen(false);
        if (voiceConversation) void speakReply("Stepping aside.");
      } else if (command.kind === "open") {
        setOpen(true);
        if (voiceConversation) void speakReply("I'm here.");
      }
      return;
    }

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
      // Speak the reply if voice mode is on. Trim down extremely long
      // responses so the user isn't stuck waiting on a 5-minute monologue.
      if (
        voiceConversation &&
        result.message.role === "assistant" &&
        result.message.content
      ) {
        const spoken =
          result.message.content.length > 600
            ? result.message.content.slice(0, 600) + "…"
            : result.message.content;
        await speakReply(spoken);
      }
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
    setTab("coworker");
    setOpen(true);
  };
  const newChat = () => {
    setConversationId(`c-${Date.now().toString(36)}`);
    setMessages([]);
    setShowHistory(false);
    setTab("coworker");
  };
  const switchConversation = (id: string) => {
    setConversationId(id);
    setShowHistory(false);
    setTab("coworker");
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
        className="fixed z-[60] grid h-14 w-14 touch-none select-none place-items-center rounded-full text-accent-fg outline-none transition"
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
          className="pointer-events-none absolute inset-[-2px] rounded-full"
          style={{
            boxShadow:
              "0 12px 32px rgba(79, 70, 229, 0.25), 0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <span
          className="relative grid h-12 w-12 place-items-center rounded-full text-white"
          style={{ backgroundColor: "var(--app-accent)" }}
        >
          <CoworkerFace
            size={28}
            speaking={speaking}
            thinking={sending}
            mood={voiceConversation ? "listening" : "happy"}
          />
          <span
            className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
              pendingCount > 0 ? "bg-amber-400" : "bg-emerald-500"
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
          speaking={speaking}
          voiceConversation={voiceConversation}
          onStartVoiceConversation={() => startVoiceConversation()}
          onStopVoiceConversation={() => stopVoiceConversation()}
          liveMode={liveMode}
          onToggleLive={() => toggleLiveMode()}
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
      className="fixed z-[59] max-w-[320px] rounded-2xl border border-app bg-app-elevated px-3 py-2 text-left text-xs text-app shadow-[0_8px_30px_rgba(34,211,238,0.18)] backdrop-blur transition hover:border-cyan-300/60 hover:bg-app-surface"
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
  /** Animated face state — true while TTS is vocalising. */
  speaking: boolean;
  /** True while in hands-free voice conversation mode. */
  voiceConversation: boolean;
  onStartVoiceConversation: () => void;
  onStopVoiceConversation: () => void;
  /** Live multimodal (webcam) mode. */
  liveMode: boolean;
  onToggleLive: () => void;
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
  speaking,
  voiceConversation,
  onStartVoiceConversation,
  onStopVoiceConversation,
  liveMode,
  onToggleLive,
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
        className="fixed inset-0 z-[58] bg-black/10 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-app bg-app-elevated text-app shadow-[0_24px_80px_rgba(0,0,0,0.18)]"
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
        <header className="relative shrink-0 border-b border-app px-3 py-2.5">
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
            <span className="relative grid h-9 w-9 place-items-center rounded-full border border-cyan-300/40 bg-app-elevated">
              <Bot className="h-4 w-4 text-cyan-200" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
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
              onClick={onToggleLive}
              className={`rounded-full p-1.5 transition ${
                liveMode
                  ? "bg-rose-100 text-rose-600 animate-pulse"
                  : "text-app-muted hover:bg-app-hover"
              }`}
              title={
                liveMode
                  ? "Live mode on — Coworker can see what's on your camera"
                  : "Start live mode (Coworker sees your camera)"
              }
            >
              <Video className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-app-muted hover:bg-app-hover"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs — Coworker (1:1 AI) / Team (channels) / Rooms (groups + DMs) */}
          <nav className="mt-2.5 flex gap-1 rounded-full border border-app bg-app p-0.5 text-[11px]">
            <TabButton
              active={tab === "coworker"}
              onClick={() => setTab("coworker")}
              icon={Bot}
              label={`Coworker${total ? ` · ${total}` : ""}`}
              accent={total > 0}
            />
            <TabButton
              active={tab === "team"}
              onClick={() => setTab("team")}
              icon={Users}
              label="Team"
            />
            <TabButton
              active={tab === "rooms"}
              onClick={() => setTab("rooms")}
              icon={MessageSquare}
              label="Rooms"
            />
          </nav>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "coworker" && (
            <>
              {/* Chat history toolbar */}
              <div className="flex shrink-0 items-center gap-1 border-b border-app px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1 rounded-full border border-app bg-app px-2 py-0.5 text-[11px] text-app-muted hover:bg-app-hover"
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
                  className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg"
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

          {tab === "team" && (
            <RoomsPanel
              filter="channel"
              organizationId={orgId}
            />
          )}

          {tab === "rooms" && (
            <RoomsPanel
              filter="private"
              organizationId={orgId}
            />
          )}
        </div>

        {/* Composer (visible on chat tab only) */}
        {tab === "coworker" && !showHistory && (
          <footer className="shrink-0 border-t border-app bg-app-hover p-2">
            {voiceConversation ? (
              <VoiceConversationView
                speaking={speaking}
                listening={!speaking && !sending}
                thinking={sending}
                onStop={onStopVoiceConversation}
              />
            ) : (
              <>
                {attachments.length > 0 && (
                  <ul className="mb-1.5 flex flex-wrap gap-1.5">
                    {attachments.map((a) => (
                      <li
                        key={a.id}
                        className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
                          a.error
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-600"
                            : a.uploading
                              ? "border-app bg-app text-app-muted"
                              : "border-accent bg-accent-soft text-accent"
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
                          className="rounded-full p-0.5 hover:bg-app-hover"
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
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-app bg-app text-app-muted hover:border-accent hover:text-accent"
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
                        : `Message ${name}, or tap the icon to talk…`
                    }
                    rows={2}
                    className="min-h-[44px] w-full resize-none rounded-xl border border-app bg-app px-2.5 py-1.5 text-xs text-app placeholder-app focus:border-accent focus:outline-none"
                    autoFocus
                  />
                  {/* Morphing button: when there's draft text, it's a
                      send (paper plane). When empty, it's a mic that
                      tapping starts a hands-free voice conversation. */}
                  {draft.trim() ||
                  attachments.filter((a) => a.uploaded).length > 0 ? (
                    <button
                      type="button"
                      onClick={onSend}
                      disabled={
                        sending || attachments.some((a) => a.uploading)
                      }
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm disabled:opacity-40"
                      title="Send"
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onStartVoiceConversation}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-sm hover:bg-accent-hover"
                      title="Talk to Coworker"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </>
            )}
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
          ? "bg-accent-soft text-accent"
          : accent
          ? "text-amber-200 hover:bg-app-hover"
          : "text-app-muted hover:bg-app-hover"
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
      <div className="flex items-center gap-1 border-b border-app px-3 py-1.5 text-[11px] text-app-subtle">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-0.5 hover:bg-app-hover"
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
                    : "hover:bg-app-hover"
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
      <div className="shrink-0 space-y-1.5 border-b border-app p-3">
        <div className="flex gap-1.5">
          {(["fact", "preference", "episode"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                kind === k
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-app bg-app-hover text-app-subtle hover:bg-app-hover"
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
            className="min-w-0 flex-1 rounded-lg border border-app bg-app px-2 py-1 text-[11px] placeholder:text-app-faint focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!draft.trim() || adding}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50"
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
                        className="group rounded-lg border border-app bg-app-hover p-2"
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
                                        : "border-app bg-app-hover text-app-subtle hover:bg-app-hover"
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
                              className="w-full resize-none rounded-lg border border-cyan-500/30 bg-app px-2 py-1 text-[11px] focus:border-accent focus:outline-none"
                              autoFocus
                            />
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void saveEdit()}
                                className="rounded-lg bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-fg hover:bg-accent-hover"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-lg px-2 py-0.5 text-[10px] text-app-subtle hover:bg-app-hover"
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
                                  className="rounded p-0.5 hover:bg-app-hover"
                                >
                                  <Edit3 className="h-3 w-3 text-cyan-300" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void remove(m.id)}
                                  title="Forget"
                                  className="rounded p-0.5 hover:bg-app-hover"
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
          ? "ml-auto bg-accent text-accent-fg"
          : "mr-auto border border-app bg-app text-app"
      }`}
    >
      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
      {(!isUser && (tierMeta || tools.length > 0)) && (
        <div className="mt-1 flex items-center gap-1.5 border-t border-app pt-1 text-[10px] text-app-subtle">
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

/**
 * Visual surface shown in the composer slot while in voice
 * conversation mode. Animated big Coworker face + status pill +
 * stop button. The actual listen/send/speak loop lives in the parent.
 */
function VoiceConversationView({
  speaking,
  listening,
  thinking,
  onStop,
}: {
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  onStop: () => void;
}) {
  const status = speaking
    ? "Speaking…"
    : thinking
      ? "Thinking…"
      : listening
        ? "Listening…"
        : "Standing by";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent bg-accent-soft px-3 py-2.5">
      <div
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: "var(--app-accent)" }}
      >
        <CoworkerFace
          size={32}
          speaking={speaking}
          thinking={thinking}
          mood="listening"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-app">Voice conversation</p>
        <p className="flex items-center gap-1.5 text-[11px] text-app-muted">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              speaking
                ? "bg-accent"
                : listening
                  ? "bg-emerald-500 animate-pulse"
                  : thinking
                    ? "bg-amber-500"
                    : "bg-app-faint"
            }`}
          />
          {status}
        </p>
      </div>
      <button
        type="button"
        onClick={onStop}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-600 text-white shadow-sm hover:bg-rose-700"
        title="End voice conversation"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Voice-to-text composer button. Uses the Web Speech API
 * (SpeechRecognition) which is available in Chromium-family browsers.
 * Falls back to disabled state otherwise. While listening, the button
 * pulses and shows interim transcripts via the onTranscript callback.
 *
 * Privacy note: the recognition runs in the user's browser — no audio
 * leaves the device until they hit Send.
 */
function VoiceInputButton({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  type SpeechWindow = Window & {
    SpeechRecognition?: typeof window.SpeechRecognition;
    webkitSpeechRecognition?: typeof window.SpeechRecognition;
  };
  const Recognition =
    (window as SpeechWindow).SpeechRecognition ??
    (window as SpeechWindow).webkitSpeechRecognition ??
    null;
  const supported = !!Recognition;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<InstanceType<NonNullable<typeof Recognition>> | null>(null);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!Recognition) return;
    const r = new Recognition();
    r.continuous = false;
    r.interimResults = false;
    r.lang = navigator.language || "en-US";
    r.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (!last) return;
      const text = last[0]?.transcript?.trim();
      if (text) onTranscript(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognitionRef.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }, [Recognition, onTranscript]);

  // Cleanup on unmount.
  useEffect(() => () => recognitionRef.current?.abort(), []);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-app bg-app text-app-muted/40"
        title="Voice input not supported in this browser"
      >
        <MicOff className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${
        listening
          ? "border-rose-400/50 bg-rose-500/10 text-rose-200 animate-pulse"
          : "border-app bg-app text-app-muted hover:border-accent hover:text-accent"
      }`}
      title={listening ? "Stop listening" : "Voice input"}
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}

/**
 * Team / Rooms panel for the CoworkerRail. Two states:
 *  1. List view — every room of the chosen kind. Click a row to open
 *     its thread *inside the rail*, not in a separate editor tab.
 *  2. Thread view — message history + composer for the selected room.
 *     Back button returns to the list.
 *
 * This replaces the previous implementation that navigated away to a
 * separate full-screen RoomEditor — that was the "nav inside a nav"
 * complaint. Keeping the chat surface single-destination here.
 *
 * `filter="channel"` → public team channels (the Team tab).
 * `filter="private"` → groups + DMs (the Rooms tab).
 */
function RoomsPanel({
  filter,
  organizationId,
}: {
  filter: "channel" | "private";
  organizationId: string | null;
}) {
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);

  const reloadRooms = useCallback(async () => {
    if (!organizationId) {
      setRooms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await roomsApi.list(organizationId);
      setRooms(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rooms.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reloadRooms();
  }, [reloadRooms, filter]);

  const filtered = rooms.filter((r) => {
    if (filter === "channel") return r.kind === "channel";
    return r.kind === "group" || r.kind === "dm";
  });

  const openRoom = filtered.find((r) => r.id === openRoomId) ?? null;

  if (openRoom) {
    return (
      <RoomThreadView
        room={openRoom}
        onBack={() => setOpenRoomId(null)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-app px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-app-subtle">
          {filter === "channel" ? "Team channels" : "Rooms & DMs"}
        </p>
        <button
          type="button"
          onClick={async () => {
            if (!organizationId) return;
            const name = window.prompt(
              filter === "channel"
                ? "Name your channel (e.g. design)"
                : "Name your room",
            );
            if (!name?.trim()) return;
            const room = await roomsApi.create({
              organizationId,
              kind: filter === "channel" ? "channel" : "group",
              name: name.trim(),
            });
            setRooms((prev) => [room, ...prev]);
            setOpenRoomId(room.id);
          }}
          className="rounded-full p-1 text-app-muted hover:bg-app-hover"
          title={filter === "channel" ? "New channel" : "New room"}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="px-2 text-[11px] text-app-subtle">Loading…</div>
        ) : error ? (
          <div className="px-2 text-[11px] text-rose-300">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="px-2 text-[11px] text-app-subtle">
            {filter === "channel"
              ? "No channels yet. Click + to start one for the team."
              : "No private rooms yet. Click + to create one."}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => setOpenRoomId(room.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-app-hover"
                >
                  {filter === "channel" ? (
                    <Hash className="h-3 w-3 text-app-subtle" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-app-subtle" />
                  )}
                  <span className="flex-1 truncate">
                    {room.name || "Untitled room"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Inline thread renderer for a single room. Lives inside the rail.
 * Reuses the existing Coworker chat patterns (message bubble + composer).
 */
function RoomThreadView({
  room,
  onBack,
}: {
  room: RoomDto;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      authorKind: "user" | "coworker" | "system";
      authorUserId: string | null;
      body: string;
      createdAt: string;
    }>
  >([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const msgs = await roomsApi.messages(room.id);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          authorKind: m.authorKind,
          authorUserId: m.authorUserId,
          body: m.body,
          createdAt: m.createdAt,
        })),
      );
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
        });
      });
    } finally {
      setLoading(false);
    }
  }, [room.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const message = await roomsApi.post(room.id, { body: draft.trim() });
      setMessages((prev) => [
        ...prev,
        {
          id: message.id,
          authorKind: message.authorKind,
          authorUserId: message.authorUserId,
          body: message.body,
          createdAt: message.createdAt,
        },
      ]);
      setDraft("");
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header */}
      <div className="flex items-center gap-2 border-b border-app px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-app-muted hover:bg-app-hover"
          title="Back to list"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        {room.kind === "channel" ? (
          <Hash className="h-3 w-3 text-app-subtle" />
        ) : (
          <Sparkles className="h-3 w-3 text-app-subtle" />
        )}
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {room.name || "Untitled room"}
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto p-3 text-xs"
      >
        {loading ? (
          <p className="text-app-subtle">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-app-subtle">
            No messages yet. Be the first to say something.
            <br />
            Use <code>@stack62</code> to summon the Coworker.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((msg) => (
              <li key={msg.id} className="flex gap-2">
                <div
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold ${
                    msg.authorKind === "coworker"
                      ? "bg-cyan-500/15 text-cyan-300"
                      : msg.authorKind === "system"
                        ? "bg-slate-500/15 text-app-subtle"
                        : "bg-violet-500/15 text-violet-300"
                  }`}
                >
                  {msg.authorKind === "coworker"
                    ? "AI"
                    : msg.authorKind === "system"
                      ? "·"
                      : "U"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-medium">
                      {msg.authorKind === "coworker"
                        ? "Coworker"
                        : msg.authorKind === "system"
                          ? "System"
                          : "Teammate"}
                    </span>
                    <span className="text-[10px] text-app-subtle">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[11px] text-app">
                    {msg.body}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-app p-2">
        <div className="flex gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message…"
            rows={2}
            className="min-h-0 flex-1 resize-none rounded-md border border-app bg-app px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="button"
            onClick={send}
            disabled={posting || !draft.trim()}
            className="rounded-md bg-accent px-2 text-accent-fg hover:opacity-90 disabled:opacity-40"
            title="Send"
          >
            <Send className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
