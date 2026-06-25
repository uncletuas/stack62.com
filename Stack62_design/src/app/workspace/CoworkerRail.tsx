import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarClock,
  CheckCircle2,
  Check,
  CheckCheck,
  ChevronLeft,
  CornerUpLeft,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Forward,
  GitBranch,
  Globe,
  Hash,
  History,
  Loader2,
  Mail,
  Maximize2,
  Minimize2,
  PanelRight,
  Users,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  PauseCircle,
  Plus,
  RefreshCcw,
  Send,
  Smile,
  Sparkles,
  Sticker as StickerIcon,
  Trash2,
  UserPlus,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { appDialog } from "../components/app-dialog";
import { AttachmentPicker } from "../components/AttachmentPicker";
import { useAppContext } from "../context/app-context";
import {
  bulkInviteOrganizationMembers,
  coworkerChat,
  createCoworkerMemory,
  createSchedule,
  deleteCoworkerMemory,
  fetchAiRequests,
  fetchCoworker,
  fetchCoworkerConversations,
  fetchCoworkerMemories,
  fetchCoworkerMessages,
  fetchFileBlobUrl,
  fetchMeetingBotSessions,
  fetchIntegrationConnections,
  fetchOrganizationMembers,
  fetchPendingInvites,
  fetchWhatsAppConversationMessages,
  fetchWhatsAppConversations,
  fetchWorkflowRuns,
  deleteWhatsAppMessage,
  reactWhatsAppMessage,
  refreshWhatsAppAvatar,
  removeMembership,
  revokeOrgInvite,
  scheduleMeetingBot,
  sendIntegrationWhatsApp,
  sendIntegrationWhatsAppMedia,
  updateCoworkerMemory,
  updateWhatsAppConversation,
  uploadFile,
  userAvatarUrl,
  type AiChangeRequest,
  type Coworker,
  type CoworkerConversation,
  type CoworkerMemory,
  type CoworkerMemoryKind,
  type CoworkerMessage,
  type CoworkerRole,
  type MeetingBotSession,
  type OrganizationMember,
  type OrgInvite,
  type StoredFile,
  type WhatsAppConversation,
  type WhatsAppConversationMessage,
  type WorkflowRun,
} from "../lib/resources";
import {
  useWorkspace,
  type EditorKind,
  type EditorTab,
} from "./workspace-context";
import { roomsApi, type RoomDto } from "../lib/dms-resources";
import { CoworkerFace, type CoworkerMood } from "./CoworkerFace";
import { CoworkerCallView } from "./CoworkerCallView";
import { RealtimeVoiceClient } from "../lib/realtime-voice";
import { classifyMood } from "../lib/mood";

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

type PanelTab = "coworker" | "team" | "rooms" | "whatsapp";

/**
 * How the chat pad is presented:
 *  - `phone`  — small iPhone-sized floating card (the default).
 *  - `full`   — near-fullscreen sheet for focused conversations.
 *  - `docked` — a right-hand column so the chat and the open screen can
 *               be used side by side. Entered automatically when the user
 *               navigates to another screen while the chat is open.
 */
type PanelView = "phone" | "full" | "docked";

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
  const [view, setView] = useState<PanelView>("phone");
  const [position, setPosition] = useState<Position>(() => loadPosition());

  // When the user navigates to another screen while the chat is open, the
  // pad closes itself and gets out of the way — UNLESS it's docked to the
  // right-hand column, where it's meant to live alongside the open screen.
  // Because navigation auto-closes the floating views, there's no separate
  // close button in the header.
  const prevTabIdRef = useRef<string | null>(activeTab?.id ?? null);
  useEffect(() => {
    const id = activeTab?.id ?? null;
    if (id !== prevTabIdRef.current) {
      prevTabIdRef.current = id;
      if (open && view !== "docked") setOpen(false);
    }
  }, [activeTab?.id, open, view]);

  // Which secondary chat surfaces actually have something to show yet.
  // Team / Rooms / WhatsApp tabs only appear once a member has been added,
  // a room created, or a WhatsApp device connected — until then the pad is
  // just the Coworker chat. Re-checked whenever the pad opens or the user
  // navigates, so a newly-created surface shows up without a reload.
  const [hasTeam, setHasTeam] = useState(false);
  const [hasRooms, setHasRooms] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  useEffect(() => {
    if (!open || !orgId) return;
    let live = true;
    void (async () => {
      const [members, invites, rooms, connections] = await Promise.all([
        fetchOrganizationMembers(orgId).catch(() => []),
        fetchPendingInvites(orgId).catch(() => []),
        roomsApi.list(orgId).catch(() => []),
        fetchIntegrationConnections({ organizationId: orgId }).catch(() => []),
      ]);
      if (!live) return;
      setHasTeam(members.length > 1 || invites.length > 0);
      setHasRooms(
        rooms.some((r) => r.kind === "channel" || r.kind === "group"),
      );
      setHasWhatsApp(
        connections.some(
          (c) =>
            (c.providerKey === "whatsapp-web" ||
              c.providerKey === "whatsapp-cloud") &&
            c.status !== "disconnected",
        ),
      );
    })();
    return () => {
      live = false;
    };
  }, [open, orgId, workspaceId, activeTab?.id]);

  // If the active tab is hidden (its surface no longer / not yet exists),
  // fall back to the Coworker chat so we never strand the user on a tab
  // that isn't rendered.
  useEffect(() => {
    if (
      (tab === "team" && !hasTeam) ||
      (tab === "rooms" && !hasRooms) ||
      (tab === "whatsapp" && !hasWhatsApp)
    ) {
      setTab("coworker");
    }
  }, [tab, hasTeam, hasRooms, hasWhatsApp]);

  // Global listener: anything that wants to summon the Coworker can
  // dispatch `stack62:open-coworker`. Used by the Welcome quick
  // action and the command palette.
  useEffect(() => {
    const onSummon = () => {
      setOpen(true);
      setTab("coworker");
      setView("phone");
    };
    window.addEventListener("stack62:open-coworker", onSummon);
    return () => window.removeEventListener("stack62:open-coworker", onSummon);
  }, []);
  /** True while the speech synthesizer is actively vocalising. Used to
   * animate the Coworker face (mouth moves) so the bot looks alive. */
  const [speaking, setSpeaking] = useState(false);
  /**
   * Bumped on every speech-boundary event from the active TTS
   * utterance so the Coworker face can "punch" the mouth open on
   * each spoken word. The face component watches this number and
   * fires a one-shot wider opening on each increment.
   */
  const [mouthPulse, setMouthPulse] = useState(0);
  /** True when the Coworker config has autonomousMode on. Drives
   *  the emerald color + AUTO badge on the launcher. */
  const autonomous = !!coworker?.autonomousMode;
  /**
   * Derived mood for the face — recomputed from the most-recent
   * assistant and user messages whenever the conversation grows or
   * the voice connection state changes. Listening wins when realtime
   * voice is connected and nothing has been said yet.
   */
  const [mood, setMood] = useState<CoworkerMood>("happy");
  /** Voice conversation mode — continuous loop where the rail listens,
   * sends the recognised utterance, speaks the reply, then re-listens.
   * Toggled by the morphing send/voice button in the composer. */
  const [voiceConversation, setVoiceConversation] = useState(false);
  /** Live multimodal mode — periodic webcam snapshots get sent so the
   * Coworker can react to what it sees. Toggled separately. */
  const [liveMode, setLiveMode] = useState(false);

  // Recompute the face mood from recent conversation. Runs cheaply
  // on every message append + on voice-connect toggle. We sample
  // only the latest user + assistant turns so a single happy reply
  // doesn't keep the face smiling forever after sad news.
  useEffect(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    setMood(
      classifyMood({
        assistantText: lastAssistant?.content,
        userText: lastUser?.content,
        listening: voiceConversation && !speaking,
      }),
    );
  }, [messages, voiceConversation, speaking]);

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

  /**
   * Always-current reference to `send`. The voice loop captures this
   * ref instead of the function directly, so it never invokes a stale
   * closure (which had the bug of bailing out because `draft` was
   * empty at the time the loop captured `send`).
   */
  const sendRef = useRef<(text?: string) => Promise<void>>(
    async () => undefined,
  );

  /**
   * OpenAI Realtime WebRTC client. When available it replaces the
   * Web Speech listen/send/speak loop entirely — audio in + LLM +
   * audio out all go through a single WebRTC peer connection with
   * ~200ms latency (vs ~2s for the Web Speech round trip).
   *
   * We try Realtime first; if the backend hasn't been configured
   * with OPENAI_API_KEY, or the browser refuses the mic, or any other
   * step fails, we silently fall back to the Web Speech path.
   */
  const realtimeRef = useRef<RealtimeVoiceClient | null>(null);
  const [realtimeActive, setRealtimeActive] = useState(false);
  /** True while the realtime client is actively pushing live frames
   *  to OpenAI — drives the green "SEEING" pill on the call view. */
  const [visionLive, setVisionLive] = useState(false);

  const stopVoiceConversation = useCallback(() => {
    setVoiceConversation(false);
    voiceConversationRef.current = false;
    // Tear down realtime if it was the active path.
    if (realtimeRef.current) {
      realtimeRef.current.close();
      realtimeRef.current = null;
    }
    setRealtimeActive(false);
    // Tear down the Web Speech path too.
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    stopSpeaking();
  }, []);

  const startVoiceConversation = useCallback(async () => {
    // Always flip the UI to voice mode immediately so the user gets
    // visual feedback while we negotiate the connection.
    setVoiceConversation(true);
    voiceConversationRef.current = true;

    // Try OpenAI Realtime first.
    try {
      const client = new RealtimeVoiceClient();
      await client.connect({
        onAssistantSpeakingStart: () => setSpeaking(true),
        onAssistantSpeakingEnd: () => setSpeaking(false),
        onAssistantTranscriptDelta: () => {
          // Each transcript chunk → one mouth pulse so the face
          // punches along with the speech rhythm.
          setMouthPulse((n) => n + 1);
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn("Realtime voice error", err);
        },
        onDisconnected: () => {
          setRealtimeActive(false);
          setSpeaking(false);
        },
      });
      realtimeRef.current = client;
      setRealtimeActive(true);
      return;
    } catch (err) {
      // Realtime unavailable — fall through to Web Speech path.
      // eslint-disable-next-line no-console
      console.info(
        "Realtime voice unavailable, falling back to Web Speech:",
        err instanceof Error ? err.message : err,
      );
    }

    const Recognition =
      (window as SpeechWindow).SpeechRecognition ??
      (window as SpeechWindow).webkitSpeechRecognition ??
      null;
    if (!Recognition) {
      // Neither Realtime nor Web Speech — admit defeat.
      setVoiceConversation(false);
      voiceConversationRef.current = false;
      void appDialog.alert({
        title: "Voice mode unavailable",
        description:
          "Voice mode needs either a backend OpenAI key or the Web Speech API. This browser doesn't expose either.",
        tone: "info",
      });
    }
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
    // OpenAI Realtime owns audio when active — don't run the fallback
    // Web Speech listen loop concurrently or both would compete for
    // the mic.
    if (realtimeActive) return;
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
          // Pass the transcript directly into send() instead of
          // routing through React state — otherwise send() would
          // capture the stale (empty) draft from this render and
          // bail out with the "no text, no attachments" early-return.
          await sendRef.current(transcript);
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
  // Real video-call surface: webcam stream is displayed full-screen,
  // voice conversation auto-starts so the user can talk + hear replies
  // in real time, and frame snapshots are queued every 6s so vision
  // tools can react to what's in front of the camera.
  //
  // True realtime streaming (Gemini Live / OpenAI Realtime) requires a
  // different provider API than OpenRouter; this is the best we can do
  // through chat-completions today and it feels close to a real call.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  /** True while the browser is asking the user for camera permission
   *  and we haven't yet got a stream. Drives the call-view's loading
   *  spinner so the user knows something is happening when they tap
   *  the live button. */
  const [liveStarting, setLiveStarting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  /** Mirror of liveStream as a ref so the vision-attach retry loop
   *  can observe "user toggled off mid-retry" without re-rendering. */
  const liveStreamRef = useRef<MediaStream | null>(null);

  const stopLive = useCallback(() => {
    setLiveMode(false);
    setMicOn(true);
    // Also exit voice conversation, since it was auto-started by live.
    setVoiceConversation(false);
    voiceConversationRef.current = false;
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    // Detach the realtime vision stream too, so frames stop flowing
    // when the user ends the call.
    realtimeRef.current?.detachVideoStream();
    setVisionLive(false);
    liveStreamRef.current = null;
    setLiveStream((cur) => {
      cur?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const toggleLiveMode = useCallback(async () => {
    if (liveMode || liveStarting) {
      stopLive();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveError(
        "Live mode needs a webcam. This browser doesn't expose camera access.",
      );
      return;
    }
    // Surface the call view IMMEDIATELY in a "starting" state so the
    // user sees something happen on tap. The view shows a loading
    // spinner until the camera stream resolves; if permission is
    // denied, we error out with a visible message in the view itself.
    setLiveError(null);
    setLiveStarting(true);
    setLiveMode(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      });
      setLiveStream(stream);
      liveStreamRef.current = stream;
      setLiveStarting(false);
      // Auto-start the voice conversation loop so the user can speak
      // and hear responses without separately tapping the mic. This
      // also lazily spins up the realtime client we then attach video to.
      setVoiceConversation(true);
      voiceConversationRef.current = true;

      // Phase 2: realtime vision. Wait for the realtime client to be
      // ready (startVoiceConversation runs async), then attach the
      // video stream — frames flow through the OpenAI Realtime data
      // channel at 2s intervals and become live conversational
      // context. The Coworker can actually "see" what's on camera.
      //
      // Fall back path: if realtime never connects (no OPENAI_API_KEY
      // / Web Speech only), the old upload-as-attachment snapshot
      // pipeline kicks in instead so the server-side vision tools
      // still see something every 6s.
      const tryAttachVision = (attempt: number) => {
        if (!liveStreamRef.current) return; // toggled off
        const client = realtimeRef.current;
        if (client && client.isConnected()) {
          void client
            .attachVideoStream(stream, { intervalMs: 2000 })
            .then(() => setVisionLive(true))
            .catch(() => setVisionLive(false));
          return;
        }
        if (attempt < 10) {
          // Retry every 500ms for up to 5s while the WebRTC handshake
          // settles. Then fall through to the snapshot pipeline.
          window.setTimeout(() => tryAttachVision(attempt + 1), 500);
          return;
        }
        // Fallback: old snapshot-every-6s path so non-realtime users
        // still get some vision context server-side.
        liveTimerRef.current = window.setInterval(async () => {
          try {
            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            await video.play();
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 360;
            canvas.getContext("2d")?.drawImage(video, 0, 0);
            const blob = await new Promise<Blob | null>((r) =>
              canvas.toBlob(r, "image/jpeg", 0.7),
            );
            video.pause();
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
      };
      tryAttachVision(0);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unknown camera error.";
      setLiveError(
        msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("denied")
          ? "Camera access was denied. Allow the site to use your camera and try again."
          : `Couldn't start camera: ${msg}`,
      );
      setLiveStarting(false);
      // Leave liveMode on with liveError set — the call view shows the
      // error inside its own surface with a Retry button.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, liveStarting, stopLive]);

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
          // onboundary fires at every word/sentence in supporting
          // browsers — drives the per-word mouth punch animation.
          utterance.onboundary = () => {
            setMouthPulse((n) => n + 1);
          };
          // Fallback boundary heartbeat: if the browser doesn't fire
          // onboundary, drive a heartbeat from the utterance length
          // so the mouth still pulses ~3× per second.
          let heartbeat: number | null = null;
          const startHeartbeat = () => {
            if (heartbeat) return;
            heartbeat = window.setInterval(() => {
              setMouthPulse((n) => n + 1);
            }, 320);
          };
          const stopHeartbeat = () => {
            if (heartbeat) {
              window.clearInterval(heartbeat);
              heartbeat = null;
            }
          };
          utterance.addEventListener("start", startHeartbeat);
          utterance.addEventListener("end", stopHeartbeat);
          utterance.addEventListener("error", stopHeartbeat);
          window.speechSynthesis.speak(utterance);
          // Defensive: some Chromium builds delay onstart until the
          // utterance is fully queued. Force speaking=true after a
          // brief tick so the face animates even if onstart is late.
          window.setTimeout(() => setSpeaking(true), 50);
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
  /**
   * Send a chat message. When called with `forcedText`, that string
   * wins over the React `draft` state — the voice-conversation loop
   * sets the transcript directly without waiting for React to flush,
   * which was the cause of the "Coworker keeps listening but never
   * responds" bug.
   *
   * Also stashed in `sendRef` (below) so the voice loop always sees
   * the latest closure, not a stale one.
   */
  const send: (forcedText?: string) => Promise<void> = async (forcedText) => {
    if (!orgId || !workspaceId) return;
    const prompt = (forcedText ?? draft).trim();
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
    const ctx = activeTabContext(activeTab);
    try {
      const result = await coworkerChat({
        organizationId: orgId,
        workspaceId,
        prompt: fullPrompt,
        conversationId,
        ...(ctx.systemId ? { systemId: ctx.systemId } : {}),
        ...(ctx.hint ? { systemHint: ctx.hint } : {}),
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
      // Auto-open files the coworker opened this turn. It emits
      // `workspace.open` intents via tool calls; for file/document targets
      // (which now render in the multimedia player) we navigate straight
      // into the player so media plays without an extra click. The
      // clickable chip on the message remains for manual re-open. We only
      // auto-open file-like targets — and just the last one — to avoid
      // yanking the user around for every intent type.
      const intentCalls = Array.isArray(result.message.toolCalls)
        ? (result.message.toolCalls as Array<Record<string, unknown>>)
        : [];
      const fileOpens = extractOpenIntents(intentCalls).filter(
        (i) => i.target === "file" || i.target === "document",
      );
      const lastOpen = fileOpens[fileOpens.length - 1];
      if (lastOpen) {
        const route = openIntentToRoute(lastOpen);
        if (route) navigate(route);
      }
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
      // Tell any open document/file/system editor on the active tab
      // to refetch — the coworker may have edited it via tool calls.
      window.dispatchEvent(
        new CustomEvent("stack62:editor-refresh", {
          detail: {
            tabKind: activeTab?.kind ?? null,
            refId: activeTab?.refId ?? null,
          },
        }),
      );
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

  // Keep the voice-conversation loop pointed at the latest send closure
  // so it always sees the current draft / org / messages state.
  sendRef.current = send;

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
              setOpen((cur) => {
                const next = !cur;
                if (next) setView("phone");
                return next;
              });
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
            boxShadow: autonomous
              ? "0 12px 32px rgba(16, 185, 129, 0.32), 0 4px 12px rgba(0,0,0,0.08)"
              : "0 12px 32px rgba(79, 70, 229, 0.25), 0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
        <span
          className={`relative grid h-12 w-12 place-items-center rounded-full text-white ${
            autonomous ? "ring-2 ring-emerald-400/60" : ""
          }`}
          style={{
            backgroundColor: autonomous ? "#059669" : "var(--app-accent)",
            transition: "background-color 0.3s ease, box-shadow 0.3s ease",
          }}
        >
          <CoworkerFace
            size={28}
            speaking={speaking}
            thinking={sending}
            mood={mood}
            mouthPulse={mouthPulse}
            autonomous={autonomous}
          />
          <span
            className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
              pendingCount > 0 ? "bg-amber-400" : "bg-emerald-500"
            } ${sending && !open ? "animate-pulse" : ""}`}
          />
          {pendingCount > 0 && (
            <span className="absolute -bottom-1 -right-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-amber-950 shadow-[0_0_10px_rgba(251,191,36,0.5)]">
              {pendingCount}
            </span>
          )}
          {autonomous && (
            <span
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-700 shadow-sm"
              title="Coworker is in autonomous mode"
            >
              Auto
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

      {/* Full-screen call view when live mode is on */}
      {liveMode && (
        <CoworkerCallView
          stream={liveStream}
          speaking={speaking}
          listening={voiceConversation && !speaking && !sending}
          thinking={sending}
          micOn={micOn}
          starting={liveStarting}
          error={liveError}
          mouthPulse={mouthPulse}
          mood={mood}
          visionLive={visionLive}
          onRetry={() => {
            // Reset error then re-enter the toggle so we re-prompt
            // for camera access.
            setLiveError(null);
            stopLive();
            window.setTimeout(() => void toggleLiveMode(), 50);
          }}
          onToggleMic={() => {
            setMicOn((cur) => {
              const next = !cur;
              // Pausing the mic = pausing voice conversation; resuming = resume.
              if (next) {
                if (!voiceConversation) {
                  setVoiceConversation(true);
                  voiceConversationRef.current = true;
                }
              } else {
                setVoiceConversation(false);
                voiceConversationRef.current = false;
                try {
                  recognitionRef.current?.stop();
                } catch {
                  /* ignore */
                }
              }
              return next;
            });
          }}
          onEndCall={() => stopLive()}
        />
      )}

      {/* Genie Panel */}
      {open && !liveMode && (
        <GeniePanel
          position={position}
          name={name}
          view={view}
          setView={setView}
          tab={tab}
          setTab={setTab}
          hasTeam={hasTeam}
          hasRooms={hasRooms}
          hasWhatsApp={hasWhatsApp}
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
          mood={mood}
          voiceConversation={voiceConversation}
          onStartVoiceConversation={() => void startVoiceConversation()}
          onStopVoiceConversation={() => stopVoiceConversation()}
          liveMode={liveMode}
          onToggleLive={() => toggleLiveMode()}
          onSend={() => void send()}
          onSendText={(text) => void send(text)}
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
  view: PanelView;
  setView: (v: PanelView) => void;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  /** Whether each secondary surface exists yet — gates its tab. */
  hasTeam: boolean;
  hasRooms: boolean;
  hasWhatsApp: boolean;
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
  /** Close the pad entirely (used by the click-outside backdrop). */
  onClose: () => void;
  /** Animated face state — true while TTS is vocalising. */
  speaking: boolean;
  /** Mood derived from recent conversation — drives the face. */
  mood: CoworkerMood;
  /** True while in hands-free voice conversation mode. */
  voiceConversation: boolean;
  onStartVoiceConversation: () => void;
  onStopVoiceConversation: () => void;
  /** Live multimodal (webcam) mode. */
  liveMode: boolean;
  onToggleLive: () => void;
  onSend: () => void;
  onSendText: (text: string) => void;
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
  view,
  setView,
  tab,
  setTab,
  hasTeam,
  hasRooms,
  hasWhatsApp,
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
  mood,
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
  onSendText,
}: GeniePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Meetings sub-view inside the Coworker tab. When true the body
   *  shows the meeting-bot inline view (schedule + recent sessions)
   *  instead of the chat thread. Toggled by the calendar icon in the
   *  header. */
  const [showMeetings, setShowMeetings] = useState(false);

  const isDocked = view === "docked";
  const isFull = view === "full";
  const isPhone = view === "phone";

  // Floating phone-sized card: keep iPhone-ish proportions and clamp the
  // card fully inside the viewport near the launcher bubble.
  const PHONE_W = 390;
  const phoneH = Math.min(744, window.innerHeight - 32);
  const placeLeft = position.x > window.innerWidth - PHONE_W - 24;
  const left = placeLeft
    ? Math.max(16, position.x - PHONE_W - 16)
    : Math.min(position.x + 80, window.innerWidth - PHONE_W - 16);
  const top = Math.max(
    16,
    Math.min(position.y - 80, window.innerHeight - phoneH - 16),
  );

  const total = pending.length + waitingRuns.length;
  const activeConversation = conversations.find(
    (c) => c.conversationId === conversationId,
  );

  return (
    <>
      {/* Backdrop: clicking outside the pad closes it — except when docked
          to the side, where it lives alongside the open screen. Dimmed in
          full-screen, invisible (but still click-catching) as a phone card. */}
      {!isDocked && (
        <div
          className={`fixed inset-0 z-[58] ${
            isFull ? "bg-black/40 backdrop-blur-sm" : ""
          }`}
          style={{ animation: "stack62-pop 200ms ease-out" }}
          onClick={onClose}
        />
      )}
      <aside
        className={
          isDocked
            ? "relative z-[60] flex h-full w-[min(400px,92vw)] shrink-0 flex-col overflow-hidden border-l border-app bg-app-elevated text-app shadow-[-12px_0_48px_rgba(0,0,0,0.10)]"
            : isFull
              ? "fixed inset-0 z-[60] mx-auto flex w-full max-w-2xl flex-col overflow-hidden border border-app bg-app-elevated text-app shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:inset-4 sm:rounded-[2rem]"
              : "fixed z-[60] flex flex-col overflow-hidden rounded-[2.25rem] border border-app bg-app-elevated text-app shadow-[0_28px_90px_rgba(0,0,0,0.28)] ring-1 ring-black/5"
        }
        style={
          isPhone
            ? {
                left,
                top,
                width: PHONE_W,
                height: phoneH,
                animation: "stack62-pop 240ms ease-out",
              }
            : isFull
              ? { animation: "stack62-pop 200ms ease-out" }
              : { animation: "stack62-pop 240ms ease-out" }
        }
      >
        {/* Header — frosted, iOS-style */}
        <header className="relative shrink-0 border-b border-app/70 bg-app-surface/80 px-3 pb-2 pt-1.5 backdrop-blur-xl">
          {/* Grabber handle — a small iOS sheet affordance on the phone card */}
          {isPhone && (
            <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-app-muted/40" />
          )}
          <div className="flex items-center gap-1">
            {/* Feature actions — top left */}
            <HeaderButton
              onClick={() =>
                window.dispatchEvent(new CustomEvent("stack62:open-email-connect"))
              }
              title="Connect email"
            >
              <Mail className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton
              onClick={onToggleLive}
              active={liveMode}
              activeClassName="bg-rose-500/15 text-rose-500"
              title={
                liveMode
                  ? "Live mode on — Coworker can see your camera"
                  : "Start live mode (Coworker sees your camera)"
              }
            >
              <Video className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton
              onClick={() => {
                setTab("coworker");
                setShowMeetings(true);
              }}
              active={showMeetings && tab === "coworker"}
              title="Set up the meeting bot to attend a Google Meet"
            >
              <CalendarClock className="h-4 w-4" />
            </HeaderButton>

            {/* Window controls — dock / expand (pushed to the right) */}
            <span className="ml-auto mx-0.5 h-5 w-px bg-app/70" aria-hidden />
            <HeaderButton
              onClick={() => setView(isDocked ? "phone" : "docked")}
              active={isDocked}
              title={isDocked ? "Float as a card" : "Dock to the side"}
            >
              <PanelRight className="h-4 w-4" />
            </HeaderButton>
            <HeaderButton
              onClick={() => setView(isFull ? "phone" : "full")}
              title={isFull ? "Exit full screen" : "Full screen"}
            >
              {isFull ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </HeaderButton>
          </div>

          {/* Tabs — icon-only, no active fill. The active tab is shown by
              a coloured, slightly-larger icon plus a small dot underneath.
              Team / Rooms / WhatsApp only appear once they exist; until then
              the pad is just the Coworker chat and the tab row is hidden. */}
          {(hasTeam || hasRooms || hasWhatsApp) && (
            <nav className="mt-2 flex items-stretch justify-around">
              <IconTab
                active={tab === "coworker"}
                onClick={() => {
                  setTab("coworker");
                  setShowMeetings(false);
                }}
                label="Coworker"
                badge={total}
              >
                <CoworkerGlyph className="h-6 w-6" />
              </IconTab>
              {hasTeam && (
                <IconTab
                  active={tab === "team"}
                  onClick={() => setTab("team")}
                  label="Team"
                >
                  <Users className="h-6 w-6" />
                </IconTab>
              )}
              {hasRooms && (
                <IconTab
                  active={tab === "rooms"}
                  onClick={() => setTab("rooms")}
                  label="Rooms"
                >
                  <Hash className="h-6 w-6" />
                </IconTab>
              )}
              {hasWhatsApp && (
                <IconTab
                  active={tab === "whatsapp"}
                  onClick={() => setTab("whatsapp")}
                  label="WhatsApp"
                  activeColor="#25D366"
                >
                  <WhatsAppGlyph className="h-6 w-6" />
                </IconTab>
              )}
            </nav>
          )}
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "coworker" && showMeetings && (
            <MeetingBotInlineView
              organizationId={orgId}
              workspaceId={workspaceId}
              onClose={() => setShowMeetings(false)}
            />
          )}

          {tab === "coworker" && !showMeetings && (
            <>
              {/* Chat history toolbar — title on the left, plain icon
                  actions grouped on the right. */}
              <div className="flex shrink-0 items-center gap-2 border-b border-app px-3 py-1.5">
                <p className="min-w-0 flex-1 truncate text-[11px] text-app-subtle">
                  {activeConversation?.title ?? "New chat"}
                </p>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setShowHistory(!showHistory)}
                    className="rounded-full p-1 text-app-muted transition hover:bg-app-hover hover:text-app"
                    title="Chat history"
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="rounded-full p-1 text-app-muted transition hover:bg-app-hover hover:text-app"
                    title="New chat"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
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
                    <div className="space-y-3">
                      <p className="text-xs text-app-subtle">
                        Hi — I'm <span className="font-medium text-app">{name}</span>.
                        Ask me anything, hand off a task, or connect me to your tools.
                      </p>
                      <div className="space-y-1.5">
                        {[
                          "What's the status of my workflows?",
                          "Summarise what happened today",
                          "Draft a weekly update email",
                          "Show me tasks that are overdue",
                        ].map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => onSendText(suggestion)}
                            className="block w-full rounded-lg border border-app bg-app-hover px-3 py-2 text-left text-[11px] text-app-muted hover:border-accent/50 hover:bg-app-hover hover:text-app transition"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {messages.map((msg) => (
                        <MessageBubble key={msg.id} msg={msg} />
                      ))}
                      {sending && (
                        <li className="flex items-center gap-1 px-1">
                          <span className="flex h-1.5 w-1.5 animate-bounce rounded-full bg-app-muted" style={{ animationDelay: "0ms" }} />
                          <span className="flex h-1.5 w-1.5 animate-bounce rounded-full bg-app-muted" style={{ animationDelay: "150ms" }} />
                          <span className="flex h-1.5 w-1.5 animate-bounce rounded-full bg-app-muted" style={{ animationDelay: "300ms" }} />
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "team" && (
            <TeamMembersPanel organizationId={orgId} />
          )}

          {tab === "rooms" && (
            <RoomsPanel filter="all" organizationId={orgId} />
          )}

          {tab === "whatsapp" && (
            <WhatsAppPanel organizationId={orgId} workspaceId={workspaceId} />
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
                mood={mood}
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
          ? "text-amber-500 hover:bg-app-hover"
          : "text-app-muted hover:bg-app-hover"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

/**
 * Quiet, circular header control button (iOS-style). Inactive buttons are
 * muted and gain a soft hover; an `active` button can opt into a custom
 * highlight via `activeClassName` (defaults to a subtle accent tint).
 */
function HeaderButton({
  onClick,
  title,
  active = false,
  activeClassName = "bg-accent-soft text-accent",
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  activeClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition active:scale-90 ${
        active ? activeClassName : "text-app-muted hover:bg-app-hover hover:text-app"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Icon-only tab used in the panel header. There is no active background:
 * the active tab simply reads in its accent colour at a slightly larger
 * size, with a small dot beneath it — iOS tab-bar style. An optional
 * `badge` count and `activeColor` (e.g. WhatsApp green) are supported.
 */
function IconTab({
  active,
  onClick,
  label,
  badge,
  activeColor,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  activeColor?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="group flex flex-1 flex-col items-center gap-1 rounded-xl py-1 transition active:scale-95"
    >
      <span
        className={`relative grid h-8 w-8 place-items-center transition-all duration-200 ${
          active
            ? "scale-110"
            : "text-app-muted group-hover:text-app group-hover:scale-105"
        }`}
        style={active ? { color: activeColor ?? "var(--app-accent)" } : undefined}
      >
        {children}
        {badge ? (
          <span className="absolute -right-2 -top-1.5 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-amber-400 px-0.5 text-[9px] font-bold leading-none text-amber-950 ring-2 ring-app-surface">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </span>
      <span
        className="h-1 w-1 rounded-full transition-all duration-200"
        style={{
          backgroundColor: active
            ? activeColor ?? "var(--app-accent)"
            : "transparent",
        }}
      />
    </button>
  );
}

/** Real WhatsApp glyph (single-colour, inherits `currentColor`). */
/**
 * Flat smiling-face glyph for the Coworker tab — a vector replica of the
 * living genie face (tall oval eyes + an upward smile), drawn in
 * `currentColor` with no filled circle so it matches the line-icon styling
 * of the other tabs. The animated genie face is unchanged elsewhere.
 */
function CoworkerGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <ellipse cx="8" cy="8.6" rx="1.9" ry="3" fill="currentColor" />
      <ellipse cx="16" cy="8.6" rx="1.9" ry="3" fill="currentColor" />
      <path
        d="M4.8 12.6 Q12 21.6 19.2 12.6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  // Cropped viewBox: the source artwork has wide transparent margins, so we
  // tighten the box to the glyph's bounds — otherwise it renders much smaller
  // than the other tab icons at the same pixel size.
  return (
    <svg viewBox="16 20 316 316" fill="currentColor" className={className} aria-hidden>
      <path d="M0 0 C1.70615479 0.00845947 1.70615479 0.00845947 3.44677734 0.01708984 C27.98192145 0.36923558 51.7344424 9.01008144 70.25 25.3125 C71.05695313 25.97636719 71.86390625 26.64023438 72.6953125 27.32421875 C92.5400664 44.15182354 104.81255498 68.66966194 108.25 94.3125 C110.60563177 127.29134475 102.679804 155.06889871 80.9519043 180.23022461 C63.85365463 199.39274588 38.89141019 212.55031557 13.25 215.3125 C-7.22090522 216.24607432 -29.68381981 215.94157384 -47.5859375 204.5 C-55.24768288 201.62448075 -64.83514606 206.48151891 -72.25 208.9375 C-74.43575996 209.64978285 -76.62197444 210.36067214 -78.80859375 211.0703125 C-79.9363623 211.43672852 -81.06413086 211.80314453 -82.22607422 212.18066406 C-88.23829223 214.11170485 -94.27481612 215.96291605 -100.3125 217.8125 C-101.45460938 218.1626416 -102.59671875 218.5127832 -103.7734375 218.87353516 C-106.43192869 219.68771857 -109.09075135 220.50079461 -111.75 221.3125 C-111.16211912 216.11758701 -109.94990987 211.4329892 -108.203125 206.5 C-107.82350616 205.40292725 -107.82350616 205.40292725 -107.43621826 204.28369141 C-106.63007689 201.9578483 -105.81536357 199.63512415 -105 197.3125 C-104.46814628 195.78536637 -103.93689164 194.25802397 -103.40625 192.73046875 C-103.14493286 191.97894531 -102.88361572 191.22742188 -102.61437988 190.453125 C-102.09173454 188.94710147 -101.57048563 187.44059258 -101.05065918 185.93359375 C-99.79035245 182.28291258 -98.50917181 178.64349985 -97.17382812 175.01953125 C-96.69384006 173.67974852 -96.21401428 172.33990763 -95.734375 171 C-95.30350586 169.82824219 -94.87263672 168.65648437 -94.42871094 167.44921875 C-93.64845983 163.84322372 -94.03668063 162.51274803 -95.75 159.3125 C-96.53503906 157.70761719 -96.53503906 157.70761719 -97.3359375 156.0703125 C-97.62509033 155.48685059 -97.91424316 154.90338867 -98.2121582 154.30224609 C-110.31439181 129.5798978 -112.22770739 100.89400506 -103.80029297 74.69213867 C-93.91533015 46.1592033 -74.03841799 23.34218816 -46.86157227 10.01245117 C-31.92339049 3.03577835 -16.46486098 -0.08622926 0 0 Z M-68.75 48.3125 C-84.98812647 67.30294869 -91.70465404 90.55385267 -90.56640625 115.3046875 C-89.01137101 131.49629159 -83.30176912 145.59701348 -74.75 159.3125 C-73.75 161.3125 -73.75 161.3125 -74.55444336 164.15405273 C-74.97862549 165.33942627 -75.40280762 166.5247998 -75.83984375 167.74609375 C-76.06321915 168.37983414 -76.28659454 169.01357452 -76.51673889 169.66651917 C-77.23322543 171.69694696 -77.95956907 173.72364959 -78.6875 175.75 C-79.41087467 177.77309469 -80.13200343 179.79689169 -80.84754944 181.82276917 C-81.49841907 183.66425789 -82.15711101 185.50297621 -82.81616211 187.34155273 C-83.89992961 190.27044932 -83.89992961 190.27044932 -83.75 193.3125 C-78.11291495 191.88699093 -72.62456917 190.33055147 -67.20703125 188.20703125 C-51.46405891 182.25175741 -51.46405891 182.25175741 -45.08984375 184.5 C-41.67040232 186.10804874 -38.536153 188.10777378 -35.41796875 190.23388672 C-20.80516768 199.68344104 1.90240143 199.30444247 18.39697266 196.234375 C41.75622809 191.15605342 61.5834647 178.1109788 75.3046875 158.41796875 C88.45357394 137.42727655 93.59056612 113.87150269 89.0625 89.3125 C83.67000943 66.23062447 70.35017278 45.39300979 50.25 32.4375 C11.4906092 8.37128004 -37.7649691 14.6792675 -68.75 48.3125 Z " transform="translate(170.75,62.6875)" />
      <path d="M0 0 C1.28197266 -0.05607422 1.28197266 -0.05607422 2.58984375 -0.11328125 C5.9101781 0.45846669 6.8673912 1.79559233 9.0625 4.3125 C10.96551366 7.82782397 12.38168198 11.54435898 13.875 15.25 C14.29458984 16.23935547 14.71417969 17.22871094 15.14648438 18.24804688 C15.53771484 19.20646484 15.92894531 20.16488281 16.33203125 21.15234375 C16.68885986 22.02238037 17.04568848 22.89241699 17.41333008 23.78881836 C18.16686565 26.71822686 17.94448641 28.43916548 17.0625 31.3125 C15.3257855 33.69334805 13.42032214 35.83178266 11.4609375 38.03125 C9.85421355 40.20512138 9.85421355 40.20512138 10.06640625 42.6953125 C11.37550276 46.1348994 13.35661743 48.83406515 15.625 51.6875 C16.07681641 52.26185791 16.52863281 52.83621582 16.99414062 53.42797852 C23.27082982 61.24396155 30.3159008 66.46144498 39.0625 71.3125 C40.155625 71.93125 41.24875 72.55 42.375 73.1875 C45.39789795 74.45289914 46.82972092 74.85129651 50.0625 74.3125 C51.97556471 72.35816733 53.522739 70.55674952 55.125 68.375 C59.44313849 62.58882667 59.44313849 62.58882667 61.87817383 61.50244141 C64.92485975 61.2375122 66.67625233 62.21603356 69.4140625 63.55078125 C70.93773437 64.28651367 70.93773437 64.28651367 72.4921875 65.03710938 C73.54664063 65.56111328 74.60109375 66.08511719 75.6875 66.625 C76.7496875 67.13740234 77.811875 67.64980469 78.90625 68.17773438 C86.7593847 72.0093847 86.7593847 72.0093847 89.0625 74.3125 C90.05338377 79.86605786 89.08282813 84.67314329 86.31640625 89.53125 C81.65746898 96.14955341 73.83813688 99.76572892 66.0625 101.375 C47.01649378 102.80928768 25.3032369 88.7567721 11.49609375 77.15625 C6.80145719 73.10078931 6.80145719 73.10078931 5.0625 71.3125 C5.0625 70.6525 5.0625 69.9925 5.0625 69.3125 C4.4025 69.3125 3.7425 69.3125 3.0625 69.3125 C1.72143555 67.87890625 1.72143555 67.87890625 0.19921875 65.875 C-0.35830078 65.14410156 -0.91582031 64.41320312 -1.49023438 63.66015625 C-2.07095703 62.88542969 -2.65167969 62.11070312 -3.25 61.3125 C-3.81912109 60.56871094 -4.38824219 59.82492188 -4.97460938 59.05859375 C-13.77083866 47.44474337 -19.87129854 37.09468023 -19.45703125 22.04296875 C-18.33504731 13.98661787 -14.38759733 6.36798169 -7.9375 1.3125 C-5.06927682 0.35642561 -2.99505254 0.08557293 0 0 Z " transform="translate(136.9375,120.6875)" />
    </svg>
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
            Nothing remembered yet. Teach me a fact ("we invoice on net-30
            terms"), a preference ("default to weekly cadence"), or an episode
            ("hired Maya on Mar 5"). Memories are scoped to this workspace.
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

/**
 * Map a `workspace.open` intent (returned by the engine's
 * `workspace.open` tool) to an editor kind + nav payload. Unknown
 * targets fall through so old messages with newer/unknown targets
 * just render as a generic "Open" chip.
 */
function openIntentToRoute(intent: {
  target: string;
  id?: string;
  folderId?: string;
  title?: string;
}): { kind: EditorKind; title: string; refId?: string } | null {
  const t = intent.target;
  const baseTitle = intent.title ?? null;
  switch (t) {
    case "file":
      return { kind: "file", title: baseTitle ?? "File", refId: intent.id };
    case "document":
      return {
        kind: "document",
        title: baseTitle ?? "Document",
        refId: intent.id,
      };
    case "workspace-doc":
    case "workspace-sheet":
    case "workspace-slides":
      return {
        kind: "workspace-doc",
        title:
          baseTitle ??
          (t === "workspace-doc"
            ? "Document"
            : t === "workspace-sheet"
              ? "Sheet"
              : "Presentation"),
        refId: intent.id,
      };
    case "system":
      return { kind: "system", title: baseTitle ?? "System", refId: intent.id };
    case "task":
      return { kind: "task", title: baseTitle ?? "Task", refId: intent.id };
    case "schedule":
      return {
        kind: "schedule",
        title: baseTitle ?? "Schedule",
        refId: intent.id,
      };
    case "plan":
      return { kind: "plan", title: baseTitle ?? "Plan", refId: intent.id };
    case "report":
      return {
        kind: "report",
        title: baseTitle ?? "Report",
        refId: intent.id,
      };
    case "workflow":
      return {
        kind: "workflow",
        title: baseTitle ?? "Workflow",
        refId: intent.id,
      };
    case "meeting-bot":
      return {
        kind: "meeting-bot",
        title: baseTitle ?? "Meeting bot",
        refId: intent.id,
      };
    case "room":
      return { kind: "room", title: baseTitle ?? "Room", refId: intent.id };
    case "browser":
      // intent.id carries the URL the coworker opened.
      return { kind: "browser", title: baseTitle ?? "Browser", refId: intent.id };
    case "files-explorer":
    case "folder":
      return { kind: "files-explorer", title: baseTitle ?? "Files" };
    default:
      return null;
  }
}

function iconForTarget(target: string): LucideIcon {
  switch (target) {
    case "file":
    case "document":
      return FileText;
    case "folder":
    case "files-explorer":
      return Paperclip;
    case "system":
      return GitBranch;
    case "task":
      return CheckCircle2;
    case "schedule":
      return Workflow;
    case "plan":
      return Edit3;
    case "meeting-bot":
      return Video;
    case "room":
      return Hash;
    case "browser":
      return Globe;
    default:
      return Sparkles;
  }
}

/**
 * Extract `workspace.open` intents the engine emitted for this
 * message. The chat backend stores tool calls as raw event objects;
 * we walk them looking for a `tool.result` whose payload contains an
 * `intent: 'workspace.open'` object.
 */
function extractOpenIntents(
  toolCalls: Array<Record<string, unknown>>,
): Array<{
  target: string;
  id?: string;
  folderId?: string;
  title?: string;
}> {
  const out: Array<{
    target: string;
    id?: string;
    folderId?: string;
    title?: string;
  }> = [];
  for (const tc of toolCalls) {
    if (tc.type !== "tool.result" && tc.type !== "tool.call") continue;
    const output =
      (tc.output as Record<string, unknown> | undefined) ??
      (tc.input as Record<string, unknown> | undefined);
    if (!output) continue;
    const intent = output.intent;
    if (intent !== "workspace.open") continue;
    const target = typeof output.target === "string" ? output.target : null;
    if (!target) continue;
    out.push({
      target,
      id: typeof output.id === "string" ? output.id : undefined,
      folderId:
        typeof output.folderId === "string" ? output.folderId : undefined,
      title: typeof output.title === "string" ? output.title : undefined,
    });
  }
  return out;
}

function MessageBubble({ msg }: { msg: CoworkerMessage }) {
  const isUser = msg.role === "user";
  const { navigate } = useWorkspace();
  const tools = useMemo(
    () =>
      Array.isArray(msg.toolCalls)
        ? (msg.toolCalls as Array<Record<string, unknown>>)
        : [],
    [msg.toolCalls],
  );
  const openIntents = useMemo(() => extractOpenIntents(tools), [tools]);

  const onOpenIntent = (intent: {
    target: string;
    id?: string;
    folderId?: string;
    title?: string;
  }) => {
    const route = openIntentToRoute(intent);
    if (!route) return;
    navigate(route);
  };

  return (
    <li
      className={`max-w-[88%] rounded-2xl px-2.5 py-1.5 text-xs ${
        isUser
          ? "ml-auto bg-accent text-accent-fg"
          : "mr-auto border border-app bg-app text-app"
      }`}
    >
      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>

      {!isUser && openIntents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {openIntents.map((intent, idx) => {
            const Icon = iconForTarget(intent.target);
            const label =
              intent.title ?? defaultTargetLabel(intent.target);
            return (
              <button
                key={`${intent.target}-${intent.id ?? idx}`}
                type="button"
                onClick={() => onOpenIntent(intent)}
                className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent transition hover:bg-accent hover:text-accent-fg"
                title={`Open this ${intent.target} in the workspace`}
              >
                <Icon className="h-3 w-3" />
                <span className="max-w-[200px] truncate">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {!isUser && tools.length > 0 && (
        <div className="mt-1 flex items-center gap-1.5 border-t border-app pt-1 text-[10px] text-app-subtle">
          <span className="truncate">
            {tools.map((t) => String(t.name ?? t.tool ?? "tool")).join(" · ")}
          </span>
        </div>
      )}
    </li>
  );
}

function defaultTargetLabel(target: string): string {
  switch (target) {
    case "file":
      return "Open file";
    case "folder":
      return "Open folder";
    case "files-explorer":
      return "Open Files";
    case "document":
      return "Open document";
    case "system":
      return "Open system";
    case "task":
      return "Open task";
    case "schedule":
      return "Open schedule";
    case "plan":
      return "Open plan";
    case "report":
      return "Open report";
    case "workflow":
      return "Open workflow";
    case "meeting-bot":
      return "Open meeting bot";
    case "room":
      return "Open room";
    case "browser":
      return "Open in browser";
    default:
      return "Open";
  }
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

/**
 * Derive coworker context from the active workspace tab so the LLM
 * knows what the user is looking at. Returns systemId when the tab is
 * a system (so the backend can scope tool calls), and a free-form
 * systemHint string describing the surface for any other tab kind.
 */
function activeTabContext(
  tab: EditorTab | null | undefined,
): { systemId?: string; hint?: string } {
  if (!tab) return {};
  const refId = tab.refId;
  switch (tab.kind) {
    case "system":
    case "module":
    case "preview":
    case "history":
      return refId
        ? { systemId: refId, hint: `User is viewing system "${tab.title}".` }
        : { hint: `User is viewing system "${tab.title}".` };
    case "document":
      return { hint: `User is viewing document "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "file":
      return { hint: `User is viewing file "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "task":
      return { hint: `User is viewing task "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "schedule":
      return { hint: `User is viewing schedule "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "report":
      return { hint: `User is viewing report "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "record":
      return { hint: `User is viewing record "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "workflow":
      return { hint: `User is viewing workflow run "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "plan":
      return { hint: `User is viewing AI plan "${tab.title}" (id: ${refId ?? "n/a"}).` };
    case "room":
      return { hint: `User is in chat room "${tab.title}".` };
    default:
      return {};
  }
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
  mood,
  onStop,
}: {
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  mood: CoworkerMood;
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
          mood={mood}
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
  filter: "channel" | "private" | "all";
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
    if (filter === "private") return r.kind === "group" || r.kind === "dm";
    // "all" — everything except 1:1 DMs (DMs live in the Team tab now).
    return r.kind === "channel" || r.kind === "group";
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
          {filter === "channel"
            ? "Team channels"
            : filter === "all"
              ? "Rooms"
              : "Rooms & DMs"}
        </p>
        <button
          type="button"
          onClick={async () => {
            if (!organizationId) return;
            const name = await appDialog.prompt({
              title:
                filter === "channel" ? "New channel" : "New room",
              description:
                filter === "channel"
                  ? "Name your channel (e.g. design, engineering)."
                  : "Name your room.",
              placeholder: filter === "channel" ? "design" : "Project room",
              confirmLabel: "Create",
            });
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
 * Renders a WhatsApp message attachment inline: photos/stickers as images,
 * video and audio with native players, and documents as a downloadable chip.
 * Bytes are fetched through the authenticated file endpoint as a blob URL.
 */
function WhatsAppMediaBubble({
  fileId,
  mediaType,
  mimeType: _mimeType,
  filename,
}: {
  fileId: string;
  mediaType: "image" | "video" | "audio" | "document" | "sticker";
  mimeType: string | null;
  filename: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inline = mediaType !== "document";

  useEffect(() => {
    if (!inline) return;
    let revoked: string | null = null;
    let cancelled = false;
    fetchFileBlobUrl(fileId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        revoked = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [fileId, inline]);

  const download = async () => {
    try {
      const u = await fetchFileBlobUrl(fileId);
      const a = document.createElement("a");
      a.href = u;
      a.download = filename ?? "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
    } catch {
      /* ignore */
    }
  };

  if (mediaType === "document" || failed) {
    return (
      <button
        type="button"
        onClick={() => void download()}
        className="mb-1 flex w-full items-center gap-2 rounded-md border border-app/40 bg-app/30 px-2 py-1.5 text-left transition hover:bg-app/50"
      >
        <FileText className="h-4 w-4 shrink-0 opacity-80" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium">
            {filename ?? "Document"}
          </span>
          <span className="block text-[9px] opacity-70">Tap to download</span>
        </span>
        <Download className="h-3 w-3 shrink-0 opacity-70" />
      </button>
    );
  }

  if (!url) {
    return (
      <div className="mb-1 grid h-24 w-40 place-items-center rounded-md bg-app/30">
        <Loader2 className="h-4 w-4 animate-spin opacity-60" />
      </div>
    );
  }

  if (mediaType === "image" || mediaType === "sticker") {
    return (
      <img
        src={url}
        alt={filename ?? "image"}
        className={`mb-1 rounded-md ${
          mediaType === "sticker" ? "max-w-[120px]" : "max-h-60 max-w-full"
        }`}
      />
    );
  }
  if (mediaType === "video") {
    return (
      <video src={url} controls className="mb-1 max-h-60 max-w-full rounded-md" />
    );
  }
  return <audio src={url} controls className="mb-1 w-full" />;
}

/**
 * Round contact avatar — renders the contact's real WhatsApp profile
 * picture when we have one, falling back to an initial on an emerald
 * disc (matching WhatsApp's look) if there's no picture or the CDN URL
 * has expired.
 */
function WhatsAppAvatar({
  name,
  phone,
  avatarUrl,
  size = 28,
}: {
  name: string | null;
  phone: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (name?.trim()?.[0] ?? phone?.[0] ?? "?").toUpperCase();
  const showImg = avatarUrl && !broken;
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-500/15 font-semibold text-emerald-300"
      style={{ height: size, width: size, fontSize: Math.round(size * 0.42) }}
    >
      {showImg ? (
        <img
          src={avatarUrl}
          alt={name ?? phone}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}

/**
 * WhatsApp inbox inside the chat panel. Lists the conversations the
 * linked device / business number has identified, and lets the user
 * open a thread to read it and reply inline — the same surface that
 * used to live, read-only, in Settings. Device-linking and auto-reply
 * configuration still live in Settings ▸ WhatsApp.
 */
function WhatsAppPanel({
  organizationId,
  workspaceId,
}: {
  organizationId: string | null;
  workspaceId: string | null;
}) {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWhatsAppConversations(
        organizationId,
        workspaceId ?? undefined,
      );
      setConversations(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Backfill profile pictures for chats that don't have one yet. Existing
  // conversations predate avatar capture (or the contact's picture wasn't
  // resolvable on the last inbound), so we actively fetch via the linked
  // device when the inbox loads. Throttled + best-effort.
  useEffect(() => {
    const missing = conversations.filter((c) => !c.contactAvatarUrl).slice(0, 12);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const c of missing) {
        if (cancelled) return;
        try {
          const updated = await refreshWhatsAppAvatar(c.id);
          if (cancelled) return;
          if (updated.contactAvatarUrl) {
            setConversations((cur) =>
              cur.map((x) => (x.id === updated.id ? updated : x)),
            );
          }
        } catch {
          /* ignore — device may be offline */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the set of conversation ids changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.map((c) => c.id).join(",")]);

  // Light polling so new inbound messages surface without a manual
  // refresh while the panel is open.
  useEffect(() => {
    if (openId) return;
    const handle = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(handle);
  }, [openId, reload]);

  const open = conversations.find((c) => c.id === openId) ?? null;

  if (open) {
    return (
      <WhatsAppThreadView
        conversation={open}
        organizationId={organizationId}
        workspaceId={workspaceId}
        onBack={() => {
          setOpenId(null);
          void reload();
        }}
        onConversationChange={(updated) =>
          setConversations((cur) =>
            cur.map((c) => (c.id === updated.id ? updated : c)),
          )
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-app px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-app-subtle">
          WhatsApp{conversations.length > 0 && ` · ${conversations.length}`}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="rounded-full p-1 text-app-muted hover:bg-app-hover"
          title="Refresh"
        >
          <RefreshCcw className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading ? (
          <div className="px-2 text-[11px] text-app-subtle">Loading…</div>
        ) : error ? (
          <div className="px-2 text-[11px] text-rose-300">{error}</div>
        ) : conversations.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-app-subtle">
            No WhatsApp chats yet. They appear here as customers message your
            linked number. Link a device in{" "}
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("stack62:open-settings", {
                    detail: { section: "whatsapp" },
                  }),
                )
              }
              className="font-medium text-accent hover:underline"
            >
              Settings ▸ WhatsApp
            </button>
            .
          </div>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-app-hover"
                >
                  <WhatsAppAvatar
                    name={c.contactName}
                    phone={c.contactPhone}
                    avatarUrl={c.contactAvatarUrl}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-medium text-app">
                        {c.contactName ?? `+${c.contactPhone}`}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-app-faint">
                      {c.lastMessagePreview ?? "—"}
                    </span>
                  </span>
                  {c.autoReplyOverride === false && (
                    <PauseCircle
                      className="h-3 w-3 shrink-0 text-amber-300"
                      aria-label="Auto-reply paused"
                    />
                  )}
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
 * A single WhatsApp conversation thread inside the rail. Reads the
 * message history, lets the user pause/resume the auto-reply bot for
 * this contact, and send a manual reply (delivered via the linked
 * device / business number).
 */
function WhatsAppThreadView({
  conversation,
  organizationId,
  workspaceId,
  onBack,
  onConversationChange,
}: {
  conversation: WhatsAppConversation;
  organizationId: string | null;
  workspaceId: string | null;
  onBack: () => void;
  onConversationChange: (updated: WhatsAppConversation) => void;
}) {
  const { user } = useAppContext();
  const [messages, setMessages] = useState<WhatsAppConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reply / select / forward / record state.
  const [replyingTo, setReplyingTo] =
    useState<WhatsAppConversationMessage | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState<WhatsAppConversationMessage[] | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);

  const ownAvatarUrl = user?.id ? userAvatarUrl(user.id) : null;
  const paused = conversation.autoReplyOverride === false;

  const scrollToEnd = (behavior: ScrollBehavior = "auto") =>
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior,
      }),
    );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchWhatsAppConversationMessages(conversation.id);
      setMessages(result.messages);
      scrollToEnd();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread.");
    } finally {
      setLoading(false);
    }
  }, [conversation.id]);

  useEffect(() => {
    void load();
    // Mark the thread read on open.
    void updateWhatsAppConversation(conversation.id, { markRead: true })
      .then(onConversationChange)
      .catch(() => undefined);
    // Refresh the contact's profile picture on open so the header + bubbles
    // show their real avatar even on older chats that predate avatar capture.
    if (!conversation.contactAvatarUrl) {
      void refreshWhatsAppAvatar(conversation.id)
        .then((updated) => {
          if (updated.contactAvatarUrl) onConversationChange(updated);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const togglePause = async () => {
    const next = paused ? null : false;
    try {
      const updated = await updateWhatsAppConversation(conversation.id, {
        autoReplyOverride: next,
      });
      onConversationChange(updated);
    } catch {
      /* ignore */
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !organizationId) return;
    setSending(true);
    setError(null);
    const replyId = replyingTo?.id;
    // Optimistic append.
    const optimistic: WhatsAppConversationMessage = {
      id: `tmp-${Date.now()}`,
      conversationId: conversation.id,
      direction: "outbound",
      text,
      authoredBy: "user",
      status: "sending",
      createdAt: new Date().toISOString(),
      mediaType: null,
      mediaFileId: null,
      mediaMimeType: null,
      mediaFilename: null,
      replyToMessageId: replyId ?? null,
      replyToPreview: replyingTo
        ? replyingTo.text || `[${replyingTo.mediaType ?? "message"}]`
        : null,
      reactions: null,
      deleted: false,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setReplyingTo(null);
    scrollToEnd("smooth");
    try {
      await sendIntegrationWhatsApp({
        organizationId,
        workspaceId: workspaceId ?? undefined,
        to: conversation.contactPhone,
        message: text,
        replyToMessageId: replyId,
      });
      // Re-pull canonical messages so the optimistic row gets its real id/status.
      await load();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  // Upload + send a stored file as WhatsApp media. `opts` controls voice-note
  // (ptt) and sticker variants; any typed text rides along as the caption.
  const sendMediaFile = async (
    file: File,
    opts: {
      ptt?: boolean;
      forceType?: "image" | "video" | "audio" | "document" | "sticker";
    } = {},
  ) => {
    if (!organizationId || sending) return;
    setSending(true);
    setError(null);
    const caption = draft.trim();
    const replyId = replyingTo?.id;
    scrollToEnd("smooth");
    try {
      const stored = await uploadFile({
        file,
        organizationId,
        workspaceId: workspaceId ?? undefined,
        scope: "attachment",
      });
      await sendIntegrationWhatsAppMedia({
        organizationId,
        workspaceId: workspaceId ?? undefined,
        to: conversation.contactPhone,
        fileId: stored.id,
        caption: opts.forceType === "sticker" ? undefined : caption || undefined,
        ptt: opts.ptt,
        forceType: opts.forceType,
        replyToMessageId: replyId,
      });
      setDraft("");
      setReplyingTo(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send attachment.");
    } finally {
      setSending(false);
    }
  };
  // Send an already-stored file (chosen from the Library / Google Drive) by id.
  const sendStoredFile = async (
    file: StoredFile,
    opts: { forceType?: "image" | "video" | "audio" | "document" | "sticker" } = {},
  ) => {
    if (!organizationId || sending) return;
    setSending(true);
    setError(null);
    const caption = draft.trim();
    const replyId = replyingTo?.id;
    scrollToEnd("smooth");
    try {
      await sendIntegrationWhatsAppMedia({
        organizationId,
        workspaceId: workspaceId ?? undefined,
        to: conversation.contactPhone,
        fileId: file.id,
        caption: caption || undefined,
        forceType: opts.forceType,
        replyToMessageId: replyId,
      });
      setDraft("");
      setReplyingTo(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send attachment.");
    } finally {
      setSending(false);
    }
  };

  // ── Voice notes ──────────────────────────────────────────────────────────
  const startRecording = async () => {
    if (recording || sending) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size > 0) {
          const ext = blob.type.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
            type: blob.type,
          });
          void sendMediaFile(file, { ptt: true, forceType: "audio" });
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access was denied.");
    }
  };
  const stopRecording = (send = true) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!send) recorder.onstop = null as never;
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
    recorderRef.current = null;
    setRecording(false);
  };

  // ── Reactions / delete ───────────────────────────────────────────────────
  const reactTo = async (message: WhatsAppConversationMessage, emoji: string) => {
    const current = message.reactions?.me;
    const next = current === emoji ? "" : emoji; // tapping the same emoji clears it
    // Optimistic.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? {
              ...m,
              reactions: next
                ? { ...(m.reactions ?? {}), me: next }
                : (() => {
                    const r = { ...(m.reactions ?? {}) };
                    delete r.me;
                    return Object.keys(r).length ? r : null;
                  })(),
            }
          : m,
      ),
    );
    try {
      await reactWhatsAppMessage(message.id, next);
    } catch {
      void load();
    }
  };

  const deleteMessage = async (message: WhatsAppConversationMessage) => {
    const ok = await appDialog.confirm({
      title: "Delete for everyone?",
      description: "This removes the message from the chat for both sides.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await deleteWhatsAppMessage(message.id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id ? { ...m, deleted: true, text: "", mediaFileId: null } : m,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  };

  // ── Forward ──────────────────────────────────────────────────────────────
  const forwardTo = async (target: WhatsAppConversation) => {
    const msgs = forwarding ?? [];
    setForwarding(null);
    setSelectMode(false);
    setSelectedIds(new Set());
    if (!organizationId || msgs.length === 0) return;
    setSending(true);
    setError(null);
    try {
      for (const m of msgs) {
        if (m.mediaFileId) {
          await sendIntegrationWhatsAppMedia({
            organizationId,
            workspaceId: workspaceId ?? undefined,
            to: target.contactPhone,
            fileId: m.mediaFileId,
            caption: m.text || undefined,
            forceType: m.mediaType ?? undefined,
          });
        } else if (m.text) {
          await sendIntegrationWhatsApp({
            organizationId,
            workspaceId: workspaceId ?? undefined,
            to: target.contactPhone,
            message: m.text,
          });
        }
      }
      if (target.id === conversation.id) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't forward.");
    } finally {
      setSending(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header */}
      <div className="flex items-center gap-2 border-b border-app px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-app-muted hover:bg-app-hover"
          title="Back to chats"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <WhatsAppAvatar
          name={conversation.contactName}
          phone={conversation.contactPhone}
          avatarUrl={conversation.contactAvatarUrl}
          size={24}
        />
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {conversation.contactName ?? `+${conversation.contactPhone}`}
        </p>
        {selectMode ? (
          <button
            type="button"
            onClick={() => {
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
            className="rounded-full bg-app-hover px-2 py-0.5 text-[10px] text-app-muted hover:text-app"
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="rounded-full bg-app-hover px-2 py-0.5 text-[10px] text-app-muted hover:text-app"
              title="Select messages to forward or delete"
            >
              Select
            </button>
            <button
              type="button"
              onClick={() => void togglePause()}
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                paused
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-app-hover text-app-muted hover:text-app"
              }`}
              title={
                paused
                  ? "Auto-reply is paused for this contact — tap to resume"
                  : "Pause the auto-reply bot for this contact"
              }
            >
              {paused ? "Resume bot" : "Pause bot"}
            </button>
          </>
        )}
      </div>

      {/* Selection action bar */}
      {selectMode && (
        <div className="flex items-center gap-2 border-b border-app bg-accent-soft/40 px-3 py-1.5 text-[11px]">
          <span className="font-medium text-app">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() =>
              setForwarding(messages.filter((m) => selectedIds.has(m.id)))
            }
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-accent hover:bg-app-hover disabled:opacity-40"
          >
            <Forward className="size-3" /> Forward
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={async () => {
              const targets = messages.filter((m) => selectedIds.has(m.id));
              for (const m of targets) await deleteMessage(m);
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-rose-400 hover:bg-rose-950/30 disabled:opacity-40"
          >
            <Trash2 className="size-3" /> Delete
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {loading ? (
          <p className="text-app-subtle">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-app-subtle">No messages in this chat yet.</p>
        ) : (
          <ul className="space-y-1">
            {messages.map((m) => (
              <WhatsAppMessageRow
                key={m.id}
                msg={m}
                contact={conversation}
                ownAvatarUrl={ownAvatarUrl}
                selectMode={selectMode}
                selected={selectedIds.has(m.id)}
                onToggleSelect={() => toggleSelected(m.id)}
                onReply={() => setReplyingTo(m)}
                onReact={(emoji) => void reactTo(m, emoji)}
                onDelete={() => void deleteMessage(m)}
                onForward={() => setForwarding([m])}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-app p-2">
        {error && (
          <p className="mb-1.5 rounded-md border border-rose-900/60 bg-rose-950/20 px-2 py-1 text-[10px] text-rose-200">
            {error}
          </p>
        )}
        {replyingTo && (
          <div className="mb-1.5 flex items-center gap-2 rounded-md border-l-2 border-accent bg-app-hover px-2 py-1">
            <CornerUpLeft className="size-3 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[10px] text-app-muted">
              {replyingTo.text ||
                (replyingTo.mediaType ? `[${replyingTo.mediaType}]` : "Message")}
            </span>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="rounded-full p-0.5 hover:bg-app-hover"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        {recording ? (
          <div className="flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-2">
            <span className="size-2 animate-pulse rounded-full bg-rose-500" />
            <span className="flex-1 text-[11px] text-rose-300">Recording voice note…</span>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="rounded-full px-2 py-0.5 text-[10px] text-app-muted hover:bg-app-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="grid size-8 place-items-center rounded-full bg-accent text-accent-fg"
              title="Send voice note"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <input
              ref={stickerInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void sendMediaFile(file, { forceType: "sticker" });
              }}
            />
            <button
              type="button"
              onClick={() => setShowAttach(true)}
              disabled={sending}
              className="shrink-0 rounded-md border border-app bg-app p-1.5 text-app-muted hover:border-accent hover:text-accent disabled:opacity-40"
              title="Attach from Library, Google Drive, or Desktop"
            >
              <Paperclip className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => stickerInputRef.current?.click()}
              disabled={sending}
              className="shrink-0 rounded-md border border-app bg-app p-1.5 text-app-muted hover:border-accent hover:text-accent disabled:opacity-40"
              title="Send an image as a sticker"
            >
              <StickerIcon className="size-3.5" />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Reply on WhatsApp…"
              rows={2}
              className="min-h-0 flex-1 resize-none rounded-md border border-app bg-app px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {draft.trim() ? (
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="rounded-md bg-accent px-2 py-1.5 text-accent-fg hover:opacity-90 disabled:opacity-40"
                title="Send"
              >
                {sending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Send className="size-3" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={sending}
                className="rounded-md bg-accent px-2 py-1.5 text-accent-fg hover:opacity-90 disabled:opacity-40"
                title="Record a voice note"
              >
                <Mic className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Forward picker */}
      {forwarding && (
        <ForwardPicker
          organizationId={organizationId}
          workspaceId={workspaceId}
          count={forwarding.length}
          onClose={() => setForwarding(null)}
          onPick={(target) => void forwardTo(target)}
        />
      )}

      {/* Attachment source picker (Library / Google Drive / Desktop) */}
      {organizationId && (
        <AttachmentPicker
          organizationId={organizationId}
          workspaceId={workspaceId}
          open={showAttach}
          onClose={() => setShowAttach(false)}
          onPicked={(file) => void sendStoredFile(file)}
          title="Send a file on WhatsApp"
        />
      )}
    </div>
  );
}

const WHATSAPP_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * One message in a WhatsApp thread: avatar (contact or you), an optional
 * quoted-reply banner, the bubble (media + text), reactions, time/status, and
 * a hover action bar (reply, react, forward, delete). In select mode the row
 * becomes a checkbox toggle for bulk forward/delete.
 */
function WhatsAppMessageRow({
  msg,
  contact,
  ownAvatarUrl,
  selectMode,
  selected,
  onToggleSelect,
  onReply,
  onReact,
  onDelete,
  onForward,
}: {
  msg: WhatsAppConversationMessage;
  contact: WhatsAppConversation;
  ownAvatarUrl: string | null;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  onForward: () => void;
}) {
  const [showReactions, setShowReactions] = useState(false);
  const isOwn = msg.direction === "outbound";
  const isCoworker = msg.authoredBy === "coworker";
  const isTmp = msg.status === "sending" || msg.id.startsWith("tmp-");
  const reactions = msg.reactions
    ? [msg.reactions.me, msg.reactions.them].filter(Boolean)
    : [];

  const avatar = isOwn ? (
    isCoworker ? (
      <span
        className="grid size-6 shrink-0 place-items-center rounded-full text-white"
        style={{ backgroundColor: "var(--app-accent)" }}
        title="Coworker"
      >
        <Sparkles className="size-3" />
      </span>
    ) : ownAvatarUrl ? (
      <img
        src={ownAvatarUrl}
        alt="You"
        className="size-6 shrink-0 rounded-full object-cover"
      />
    ) : (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-[10px] font-semibold text-emerald-300">
        You
      </span>
    )
  ) : (
    <WhatsAppAvatar
      name={contact.contactName}
      phone={contact.contactPhone}
      avatarUrl={contact.contactAvatarUrl}
      size={24}
    />
  );

  return (
    <li
      className={`group flex items-end gap-1.5 ${isOwn ? "flex-row-reverse" : ""}`}
      onClick={() => {
        if (selectMode) onToggleSelect();
      }}
    >
      {selectMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={`grid size-5 shrink-0 place-items-center rounded-full border ${
            selected
              ? "border-accent bg-accent text-accent-fg"
              : "border-app text-transparent"
          }`}
        >
          <Check className="size-3" />
        </button>
      )}
      {avatar}
      <div className={`relative max-w-[78%] ${isOwn ? "items-end" : ""}`}>
        <div
          className={`overflow-hidden rounded-lg px-2.5 py-1.5 ${
            isOwn
              ? "bg-emerald-600/20 text-emerald-900 dark:text-emerald-100"
              : "bg-app-hover text-app"
          }`}
        >
          {msg.deleted ? (
            <p className="flex items-center gap-1 text-[11px] italic text-app-faint">
              <Trash2 className="size-3" /> This message was deleted
            </p>
          ) : (
            <>
              {msg.replyToPreview && (
                <div className="mb-1 truncate rounded border-l-2 border-accent/60 bg-black/10 px-1.5 py-0.5 text-[10px] text-app-muted">
                  {msg.replyToPreview}
                </div>
              )}
              {msg.mediaType && msg.mediaFileId && (
                <WhatsAppMediaBubble
                  fileId={msg.mediaFileId}
                  mediaType={msg.mediaType}
                  mimeType={msg.mediaMimeType}
                  filename={msg.mediaFilename}
                />
              )}
              {msg.text && (
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
              )}
              <span className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-app-faint">
                {isOwn && (isCoworker ? "coworker" : "you")}
                {msg.status === "sending" ? " · sending…" : ""}
                {isOwn && !isTmp && <CheckCheck className="size-2.5" />}
              </span>
            </>
          )}
        </div>

        {/* Reactions badge */}
        {reactions.length > 0 && !msg.deleted && (
          <div
            className={`mt-0.5 flex gap-0.5 ${isOwn ? "justify-end" : "justify-start"}`}
          >
            <span className="rounded-full border border-app bg-app-elevated px-1.5 py-0.5 text-[11px] shadow-sm">
              {reactions.join(" ")}
            </span>
          </div>
        )}

        {/* Hover action bar */}
        {!selectMode && !msg.deleted && !isTmp && (
          <div
            className={`absolute -top-7 z-10 hidden items-center gap-0.5 rounded-full border border-app bg-app-elevated px-1 py-0.5 shadow-lg group-hover:flex ${
              isOwn ? "right-0" : "left-0"
            }`}
          >
            {showReactions ? (
              <div className="flex items-center gap-0.5">
                {WHATSAPP_QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(emoji);
                      setShowReactions(false);
                    }}
                    className="rounded-full px-0.5 text-sm hover:bg-app-hover"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowReactions(true)}
                  title="React"
                  className="rounded-full p-1 text-app-muted hover:bg-app-hover hover:text-app"
                >
                  <Smile className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={onReply}
                  title="Reply"
                  className="rounded-full p-1 text-app-muted hover:bg-app-hover hover:text-app"
                >
                  <CornerUpLeft className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={onForward}
                  title="Forward"
                  className="rounded-full p-1 text-app-muted hover:bg-app-hover hover:text-app"
                >
                  <Forward className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  title="Delete for everyone"
                  className="rounded-full p-1 text-rose-400 hover:bg-rose-950/30"
                >
                  <Trash2 className="size-3" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Modal to forward selected message(s) to another WhatsApp chat. Lists the
 * org's conversations with avatars; picking one re-sends the content there.
 */
function ForwardPicker({
  organizationId,
  workspaceId,
  count,
  onClose,
  onPick,
}: {
  organizationId: string | null;
  workspaceId: string | null;
  count: number;
  onClose: () => void;
  onPick: (target: WhatsAppConversation) => void;
}) {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    fetchWhatsAppConversations(organizationId, workspaceId ?? undefined)
      .then(setConversations)
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, [organizationId, workspaceId]);

  const filtered = conversations.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.contactName ?? "").toLowerCase().includes(q) ||
      c.contactPhone.includes(q)
    );
  });

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xs flex-col overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-app px-3 py-2">
          <Forward className="size-3.5 text-accent" />
          <span className="flex-1 text-xs font-semibold">
            Forward {count} message{count === 1 ? "" : "s"} to…
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-app-muted hover:bg-app-hover"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="border-b border-app p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-md border border-app bg-app px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {loading ? (
            <p className="px-2 py-3 text-[11px] text-app-subtle">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-app-subtle">No chats.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-app-hover"
              >
                <WhatsAppAvatar
                  name={c.contactName}
                  phone={c.contactPhone}
                  avatarUrl={c.contactAvatarUrl}
                  size={26}
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {c.contactName ?? `+${c.contactPhone}`}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Team directory inside the chat panel. Lists everyone who belongs
 * to the active organization, with their avatar, name, and role. Org
 * admins get an "Add member" button and a remove control per row;
 * regular members see the list read-only. Clicking a member opens
 * (or creates) a private 1:1 DM with them.
 */
/** Roles an org admin can assign when onboarding teammates. */
const TEAM_ROLES: Array<{ value: string; label: string }> = [
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "reviewer", label: "Reviewer" },
  { value: "read_only", label: "Read only" },
];

function TeamMembersPanel({
  organizationId,
}: {
  organizationId: string | null;
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [openDmId, setOpenDmId] = useState<string | null>(null);
  const [openDmRoom, setOpenDmRoom] = useState<RoomDto | null>(null);

  // Bulk-invite composer state.
  const [showInvite, setShowInvite] = useState(false);
  const [inviteText, setInviteText] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviting, setInviting] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setMembers([]);
      setInvites([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [list, pending] = await Promise.all([
        fetchOrganizationMembers(organizationId),
        fetchPendingInvites(organizationId).catch(() => []),
      ]);
      setMembers(list);
      setInvites(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDm = async (targetUserId: string) => {
    if (!organizationId) return;
    setOpenDmId(targetUserId);
    try {
      // Look for an existing 1:1 with this user first so we reuse
      // the conversation history. Walk recent DMs and check their
      // member rosters until we find one with exactly this user.
      const all = await roomsApi.list(organizationId);
      const dms = all.filter((r) => r.kind === "dm");
      let existing: RoomDto | undefined;
      for (const dm of dms.slice(0, 30)) {
        try {
          const ms = await roomsApi.members(dm.id);
          if (
            ms.length === 2 &&
            ms.some((m) => m.userId === targetUserId)
          ) {
            existing = dm;
            break;
          }
        } catch {
          /* skip rooms we can't read members on */
        }
      }
      const room =
        existing ??
        (await roomsApi.create({
          organizationId,
          kind: "dm",
          memberUserIds: [targetUserId],
        }));
      setOpenDmRoom(room);
    } catch (err) {
      await appDialog.alert({
        title: "Couldn't open DM",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
      setOpenDmId(null);
    }
  };

  // Split a pasted blob into candidate emails on commas, semicolons,
  // whitespace, or newlines — so users can paste a whole roster.
  const parseEmails = (raw: string): string[] =>
    Array.from(
      new Set(
        raw
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes("@") && e.includes(".")),
      ),
    );

  const parsedEmails = parseEmails(inviteText);

  const onBulkInvite = async () => {
    if (!organizationId || inviting) return;
    const emails = parsedEmails;
    if (emails.length === 0) {
      setInviteSummary("Enter at least one valid email address.");
      return;
    }
    setInviting(true);
    setInviteSummary(null);
    try {
      const { summary } = await bulkInviteOrganizationMembers({
        organizationId,
        emails,
        role: inviteRole,
      });
      const parts: string[] = [];
      if (summary.invited) parts.push(`${summary.invited} invited`);
      if (summary.added) parts.push(`${summary.added} added`);
      if (summary.failed) parts.push(`${summary.failed} failed`);
      setInviteSummary(parts.join(" · ") || "Nothing to do.");
      if (!summary.failed) {
        setInviteText("");
      }
      await reload();
    } catch (err) {
      setInviteSummary(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviting(false);
    }
  };

  const onRevokeInvite = async (invite: OrgInvite) => {
    const ok = await appDialog.confirm({
      title: `Revoke invite to ${invite.email}?`,
      description: "The invitation link will stop working immediately.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokeOrgInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      await appDialog.alert({
        title: "Could not revoke",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    }
  };

  const onRemove = async (member: OrganizationMember) => {
    const name = member.user
      ? `${member.user.firstName} ${member.user.lastName}`
      : "this member";
    const ok = await appDialog.confirm({
      title: `Remove ${name}?`,
      description:
        "They'll lose access to this organization's workspaces. Their existing files and messages stay.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusyMembershipId(member.id);
    try {
      await removeMembership(member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      await appDialog.alert({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setBusyMembershipId(null);
    }
  };

  if (openDmRoom) {
    return (
      <RoomThreadView
        room={openDmRoom}
        onBack={() => {
          setOpenDmRoom(null);
          setOpenDmId(null);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-app px-3 py-2">
        <p className="text-[11px] uppercase tracking-wider text-app-subtle">
          Team members{members.length > 0 && ` · ${members.length}`}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-full p-1 text-app-muted hover:bg-app-hover"
            title="Refresh"
          >
            <RefreshCcw className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowInvite((v) => !v);
              setInviteSummary(null);
            }}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              showInvite
                ? "bg-app-hover text-app"
                : "bg-accent text-accent-fg"
            }`}
            title="Invite teammates"
          >
            <UserPlus className="h-3 w-3" /> {showInvite ? "Close" : "Invite"}
          </button>
        </div>
      </div>

      {showInvite && (
        <div className="space-y-2 border-b border-app bg-app-hover/40 p-3">
          <p className="text-[10px] text-app-subtle">
            Onboard your whole team — paste emails separated by commas, spaces,
            or new lines, pick a role, and send.
          </p>
          <textarea
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
            placeholder={"ada@acme.com, sam@acme.com\nlola@acme.com"}
            rows={3}
            className="w-full resize-none rounded-md border border-app bg-app px-2 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2">
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="h-7 rounded-md border border-app bg-app px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {TEAM_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void onBulkInvite()}
              disabled={inviting || parsedEmails.length === 0}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-accent-fg disabled:opacity-50"
            >
              {inviting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {parsedEmails.length > 0
                ? `Send ${parsedEmails.length} invite${parsedEmails.length === 1 ? "" : "s"}`
                : "Send invites"}
            </button>
          </div>
          {inviteSummary && (
            <p className="text-[10px] text-app-subtle">{inviteSummary}</p>
          )}
        </div>
      )}

      {invites.length > 0 && (
        <div className="border-b border-app px-2 py-2">
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-app-faint">
            Pending invites · {invites.length}
          </p>
          <ul className="space-y-0.5">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1 text-[11px] hover:bg-app-hover"
              >
                <Mail className="h-3 w-3 shrink-0 text-app-faint" />
                <span className="min-w-0 flex-1 truncate text-app">
                  {inv.email}
                </span>
                <span className="shrink-0 rounded-full border border-app px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-app-subtle">
                  {inv.role.replace("_", " ")}
                </span>
                <button
                  type="button"
                  onClick={() => void onRevokeInvite(inv)}
                  className="rounded p-0.5 text-app-faint opacity-0 transition hover:bg-rose-950/40 hover:text-rose-300 group-hover:opacity-100"
                  title="Revoke invite"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {loading ? (
          <div className="px-2 py-3 text-[11px] text-app-subtle">Loading team…</div>
        ) : error ? (
          <div className="px-2 py-3 text-[11px] text-rose-300">{error}</div>
        ) : members.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-app-subtle">
            No teammates yet. Click <strong>Invite</strong> to add one.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {members.map((m) => {
              const u = m.user;
              const initials = u
                ? `${u.firstName[0] ?? ""}${u.lastName[0] ?? ""}`.toUpperCase()
                : "?";
              const avatar =
                u && u.avatarFileId
                  ? userAvatarUrl(u.id, u.updatedAt)
                  : null;
              return (
                <li key={m.id}>
                  <div
                    className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-app-hover ${
                      openDmId === m.userId ? "bg-app-hover" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void openDm(m.userId)}
                      className="flex flex-1 items-center gap-2 text-left"
                      title="Open direct message"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-[10px] font-semibold text-accent-fg">
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={`${u!.firstName} ${u!.lastName}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          initials
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-app">
                          {u
                            ? `${u.firstName} ${u.lastName}`
                            : "Unknown user"}
                        </span>
                        <span className="block truncate text-[10px] text-app-faint">
                          {u?.email ?? m.role}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-app px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-app-subtle">
                        {m.role.replace("_", " ")}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRemove(m)}
                      disabled={busyMembershipId === m.id}
                      className="rounded p-1 text-app-faint opacity-0 transition hover:bg-rose-950/40 hover:text-rose-300 group-hover:opacity-100"
                      title="Remove from organization"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Inline meeting-bot setup view that lives inside the Coworker chat
 * panel. The user pastes a Google Meet URL, picks a date/time + title,
 * and clicking "Send bot" both schedules the bot worker AND creates a
 * row in the Schedules sidebar so the meeting appears alongside other
 * calendar items.
 */
function MeetingBotInlineView({
  organizationId,
  workspaceId,
  onClose,
}: {
  organizationId: string;
  workspaceId: string;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<MeetingBotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const rows = await fetchMeetingBotSessions({ organizationId });
      setSessions(rows.slice(0, 10));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    if (!url.trim() || !workspaceId) return;
    if (!/^https?:\/\/meet\.google\.com\//i.test(url.trim())) {
      await appDialog.alert({
        title: "Google Meet URL only",
        description:
          "Paste a https://meet.google.com/… link. Zoom and Teams aren't supported yet.",
        tone: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const session = await scheduleMeetingBot({
        organizationId,
        workspaceId,
        meetingUrl: url.trim(),
        title: title.trim() || undefined,
      });
      // Also record a row in the calendar so the meeting shows up
      // alongside other schedule items.
      if (startsAt) {
        await createSchedule({
          organizationId,
          workspaceId,
          title: title.trim() || `Meeting on ${new Date(startsAt).toLocaleString()}`,
          kind: "meeting",
          startsAt: new Date(startsAt).toISOString(),
          metadata: {
            meetingBotSessionId: session.id,
            meetingUrl: session.meetingUrl,
          },
        }).catch(() => undefined);
      }
      setUrl("");
      setTitle("");
      setStartsAt("");
      await reload();
    } catch (err) {
      await appDialog.alert({
        title: "Couldn't schedule the bot",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-app px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-app-subtle">
          <CalendarClock className="h-3 w-3" /> Meeting bot
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-app-faint hover:text-app"
          title="Back to chat"
        >
          Back
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        <p className="mb-2 text-app-subtle">
          Send the bot to attend a Google Meet on your behalf. It joins,
          captures captions, and posts a summary when the call ends.
        </p>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
              Meet URL
            </span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              className="w-full rounded-md border border-app bg-app-surface px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
              Title (optional)
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekly product sync"
              className="w-full rounded-md border border-app bg-app-surface px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
              Starts (optional — adds to your calendar)
            </span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md border border-app bg-app-surface px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !url.trim()}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send bot
          </button>
        </div>

        <h4 className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-app-faint">
          Recent sessions
        </h4>
        {loading ? (
          <p className="text-app-faint">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-app-faint">
            None yet. The first one you schedule will show up here.
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-app bg-app-surface px-2 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[11px] font-medium">
                    {s.title || prettyMeetHost(s.meetingUrl)}
                  </span>
                  <span className="shrink-0 rounded-full bg-app-hover px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-app-subtle">
                    {s.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-app-faint">
                  <a
                    href={s.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-app-muted"
                  >
                    open link <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                  <span>·</span>
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function prettyMeetHost(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "Meeting";
  } catch {
    return url;
  }
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
