import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  CalendarClock,
  Zap,
  CheckCircle2,
  ChevronLeft,
  Edit3,
  ExternalLink,
  FileText,
  GitBranch,
  Hash,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { appDialog } from "../components/app-dialog";
import { useAppContext } from "../context/app-context";
import {
  coworkerChat,
  createCoworkerMemory,
  createSchedule,
  deleteCoworkerMemory,
  fetchAiRequests,
  fetchCoworker,
  fetchCoworkerConversations,
  fetchCoworkerMemories,
  fetchCoworkerMessages,
  fetchMeetingBotSessions,
  fetchOrganizationMembers,
  fetchWorkflowRuns,
  inviteOrganizationMember,
  removeMembership,
  scheduleMeetingBot,
  updateCoworker,
  updateCoworkerMemory,
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
  type StoredFile,
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

  // Global listener: anything that wants to summon the Coworker can
  // dispatch `stack62:open-coworker`. Used by the Welcome quick
  // action and the command palette.
  useEffect(() => {
    const onSummon = () => {
      setOpen(true);
      setTab("coworker");
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
          mood={mood}
          voiceConversation={voiceConversation}
          onStartVoiceConversation={() => void startVoiceConversation()}
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
}: GeniePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Meetings sub-view inside the Coworker tab. When true the body
   *  shows the meeting-bot inline view (schedule + recent sessions)
   *  instead of the chat thread. Toggled by the calendar icon in the
   *  header. */
  const [showMeetings, setShowMeetings] = useState(false);
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
        }}
      >
        {/* Header — minimal, theme-aware */}
        <header className="relative shrink-0 border-b border-app bg-app-surface px-3 py-2">
          <div className="flex items-center gap-2.5">
            <span
              className="relative grid h-8 w-8 place-items-center rounded-full text-white"
              style={{ backgroundColor: "var(--app-accent)" }}
            >
              <CoworkerFace
                size={20}
                speaking={speaking}
                thinking={sending}
                mood={mood}
              />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-app-surface" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">
                {name}
              </p>
              <p className="truncate text-[10px] text-app-subtle">
                {role.replace("_", " ")}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleLive}
              className={`rounded-full p-1.5 transition ${
                liveMode
                  ? "bg-rose-500/15 text-rose-500"
                  : "text-app-muted hover:bg-app-hover"
              }`}
              title={
                liveMode
                  ? "Live mode on — Coworker can see your camera"
                  : "Start live mode (Coworker sees your camera)"
              }
            >
              <Video className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("coworker");
                setShowMeetings(true);
              }}
              className={`rounded-full p-1.5 transition ${
                showMeetings && tab === "coworker"
                  ? "bg-accent-soft text-accent"
                  : "text-app-muted hover:bg-app-hover"
              }`}
              title="Set up the meeting bot to attend a Google Meet"
            >
              <CalendarClock className="h-4 w-4" />
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

          {/* Tabs — single line, low contrast until selected.
              Team = members directory (add/remove, start a DM).
              Rooms = team channels where everyone discusses. */}
          <nav className="mt-2 flex gap-0.5 border-b border-app text-[11px]">
            <PanelTab
              active={tab === "coworker"}
              onClick={() => {
                setTab("coworker");
                setShowMeetings(false);
              }}
              icon={Bot}
              label={`Coworker${total ? ` · ${total}` : ""}`}
            />
            <PanelTab
              active={tab === "team"}
              onClick={() => setTab("team")}
              icon={Users}
              label="Team"
            />
            <PanelTab
              active={tab === "rooms"}
              onClick={() => setTab("rooms")}
              icon={MessageSquare}
              label="Rooms"
            />
          </nav>
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
                  title={coworker?.defaultAutopilot ? "Autopilot on — coworker acts without asking" : "Autopilot off — coworker asks before acting"}
                  onClick={async () => {
                    if (!orgId || !workspaceId) return;
                    const next = !(coworker?.defaultAutopilot ?? false);
                    try {
                      const updated = await updateCoworker({ organizationId: orgId, workspaceId, defaultAutopilot: next });
                      setCoworker(updated);
                    } catch { /* ignore */ }
                  }}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
                    coworker?.defaultAutopilot
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-app bg-app text-app-muted hover:bg-app-hover"
                  }`}
                >
                  <Zap className="h-3 w-3" />
                  <span>{coworker?.defaultAutopilot ? "Autopilot" : "Manual"}</span>
                </button>
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
                            onClick={() => {
                              setDraft(suggestion);
                              setTimeout(() => void send(suggestion), 0);
                            }}
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
            <TeamMembersPanel organizationId={orgId} />
          )}

          {tab === "rooms" && (
            <RoomsPanel filter="all" organizationId={orgId} />
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
 * Underline-style tab used in the panel header. Cleaner than the
 * pill variant — the panel was looking crowded with two rows of
 * colorful pills competing for attention.
 */
function PanelTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-1.5 transition ${
        active
          ? "border-accent text-accent"
          : "border-transparent text-app-muted hover:text-app"
      }`}
    >
      <Icon className="h-3 w-3" />
      <span>{label}</span>
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
  const tier =
    msg.metadata && typeof msg.metadata === "object"
      ? ((msg.metadata as Record<string, unknown>).routerTier as
          | number
          | null
          | undefined)
      : null;
  const tierMeta = tierLabel(tier);

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

      {!isUser && (tierMeta || tools.length > 0) && (
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
    default:
      return "Open";
  }
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
 * Team directory inside the chat panel. Lists everyone who belongs
 * to the active organization, with their avatar, name, and role. Org
 * admins get an "Add member" button and a remove control per row;
 * regular members see the list read-only. Clicking a member opens
 * (or creates) a private 1:1 DM with them.
 */
function TeamMembersPanel({
  organizationId,
}: {
  organizationId: string | null;
}) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyMembershipId, setBusyMembershipId] = useState<string | null>(null);
  const [openDmId, setOpenDmId] = useState<string | null>(null);
  const [openDmRoom, setOpenDmRoom] = useState<RoomDto | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchOrganizationMembers(organizationId);
      setMembers(list);
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

  const onInvite = async () => {
    if (!organizationId) return;
    const email = await appDialog.prompt({
      title: "Invite a teammate",
      description:
        "Send an email invitation. They'll get a link to join this organization.",
      placeholder: "name@example.com",
      inputType: "email",
      confirmLabel: "Send invite",
      validate: (v) =>
        !v.includes("@") || !v.includes(".")
          ? "Enter a valid email address."
          : null,
    });
    if (!email) return;
    try {
      await inviteOrganizationMember({ organizationId, email: email.trim() });
      await appDialog.alert({
        title: "Invite sent",
        description: `An invitation email is on its way to ${email}.`,
        tone: "success",
      });
      await reload();
    } catch (err) {
      await appDialog.alert({
        title: "Invite failed",
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
            onClick={() => void onInvite()}
            className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-fg"
            title="Invite a teammate"
          >
            <UserPlus className="h-3 w-3" /> Invite
          </button>
        </div>
      </div>
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
