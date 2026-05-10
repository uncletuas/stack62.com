import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  StopCircle,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Textarea } from "../components/ui/textarea";
import { useAppContext } from "../context/app-context";
import {
  chatWithAi,
  coworkerChat,
  cancelBackgroundJob,
  createAiRequest,
  createJob,
  createSchedule,
  fetchCoworkerMessages,
  fetchAiRequest,
  fetchAiRequestDiff,
  fetchJob,
  generateSystemCode,
  generateDocument,
  deploySystem,
  fetchDeployment,
  fetchDeploymentLogs,
  rejectAiRequest,
  streamEngine,
  uploadFile,
  type DocumentFormat,
  type EngineEvent,
  type EngineRunPayload,
  type StoredFile,
} from "../lib/resources";
import {
  useWorkspace,
  type ConversationIntent,
  type ConversationState,
  type EditorTab,
} from "./workspace-context";

const MODEL = import.meta.env.VITE_STACK62_AI_MODEL || "codex";

type DockMode =
  | { kind: "engine"; tab: EditorTab | null }
  | { kind: "conversation"; tab: EditorTab; intent: ConversationIntent }
  | { kind: "file-create"; tab: EditorTab };

type Attachment = {
  id: string;
  filename: string;
  uploaded?: StoredFile;
  uploading: boolean;
};

type ToolStep = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
  output?: unknown;
};

type EngineTurn =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      tools: ToolStep[];
      complete: boolean;
    };

const FORMATS: Array<{ value: DocumentFormat; label: string }> = [
  { value: "docx", label: "Word (.docx)" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "pptx", label: "PowerPoint (.pptx)" },
  { value: "pdf", label: "PDF" },
  { value: "md", label: "Markdown" },
  { value: "txt", label: "Plain text" },
];

const CONVERSATION_PRESETS: Record<
  ConversationIntent,
  { intro: string; preamble: string }
> = {
  system: {
    intro:
      "",
    preamble:
      "You are Stack62, helping a user describe a new business system. Ask one focused clarifying question at a time about purpose, who uses it, what data it tracks, what workflows it needs, integrations, and edge cases. Keep replies under 4 sentences. Don't propose a final plan yet — that happens when the user clicks Create plan.",
  },
  job: {
    intro:
      "",
    preamble:
      "You are Stack62, helping the user describe a new job for the coworker. Ask one focused clarifying question at a time about: what should be done each run (concrete instructions), when to run (manual / one-shot at a specific time / recurring with a frequency), and what success looks like. Keep replies under 4 sentences.",
  },
  schedule: {
    intro:
      "What needs to happen, and when? Tell me the title, when it starts and ends, whether it repeats, and anything important.",
    preamble:
      "You are Stack62, helping a user describe a schedule entry (meeting, milestone, deadline, task, shift, or reminder). Ask one focused clarifying question at a time. Convert relative times to absolute when confirmed. Keep replies under 3 sentences.",
  },
};

const ENGINE_HISTORY_KEY = "stack62.assistant.engineHistory";
const ENGINE_SESSIONS_KEY = "stack62.assistant.chatSessions";

type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  turns: EngineTurn[];
};

function loadEngineHistory(): EngineTurn[] {
  try {
    const sessions = loadChatSessions();
    if (sessions.length > 0) return sessions[0].turns;
    const raw = localStorage.getItem(ENGINE_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as EngineTurn[]) : [];
  } catch {
    return [];
  }
}

function saveEngineHistory(turns: EngineTurn[]) {
  try {
    localStorage.setItem(ENGINE_HISTORY_KEY, JSON.stringify(turns.slice(-30)));
  } catch {
    /* ignore */
  }
}

function newSessionId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function loadChatSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(ENGINE_SESSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((s) => s && typeof s.id === "string")
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20);
      }
    }
    const old = localStorage.getItem(ENGINE_HISTORY_KEY);
    const turns = old ? (JSON.parse(old) as EngineTurn[]) : [];
    return [
      {
        id: newSessionId(),
        title: turns.find((t) => t.kind === "user")?.text.slice(0, 42) || "New chat",
        updatedAt: Date.now(),
        turns,
      },
    ];
  } catch {
    return [{ id: newSessionId(), title: "New chat", updatedAt: Date.now(), turns: [] }];
  }
}

function saveChatSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(
      ENGINE_SESSIONS_KEY,
      JSON.stringify(
        sessions
          .filter((s) => s.turns.length > 0 || s.title === "New chat")
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20),
      ),
    );
  } catch {
    /* ignore */
  }
}

export function AssistantDock() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const {
    activeTab,
    openTab,
    navigate,
    updateTab,
    appendRunLog,
    setRunOpen,
    conversations,
    ensureConversation,
    appendMessage,
    setConversationThinking,
    fileDrafts,
    setFileDraft,
    autopilot,
    setAutopilot,
  } = useWorkspace();

  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() =>
    loadChatSessions(),
  );
  const [activeChatSessionId, setActiveChatSessionId] = useState(() => {
    const sessions = loadChatSessions();
    return sessions[0]?.id ?? newSessionId();
  });
  const [engineTurns, setEngineTurns] = useState<EngineTurn[]>(() =>
    loadChatSessions()[0]?.turns ?? loadEngineHistory(),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const currentBuildRef = useRef<{ requestId?: string; backgroundJobId?: string }>({});

  const mode: DockMode = useMemo(() => {
    if (!activeTab) return { kind: "engine", tab: null };
    if (!activeTab.refId) {
      if (activeTab.kind === "file")
        return { kind: "file-create", tab: activeTab };
    }
    return { kind: "engine", tab: activeTab };
  }, [activeTab]);

  useEffect(() => {
    if (mode.kind !== "conversation") return;
    const preset = CONVERSATION_PRESETS[mode.intent];
    ensureConversation(mode.tab.id, mode.intent, preset.intro, preset.preamble);
  }, [mode, ensureConversation]);

  useEffect(() => {
    setPrompt("");
    setAttachments([]);
  }, [activeTab?.id, mode.kind]);

  useEffect(() => {
    saveEngineHistory(engineTurns);
    setChatSessions((cur) => {
      const now = Date.now();
      const title =
        engineTurns.find((t) => t.kind === "user")?.text.slice(0, 42) ||
        "New chat";
      const existing = cur.find((s) => s.id === activeChatSessionId);
      const next = existing
        ? cur.map((s) =>
            s.id === activeChatSessionId
              ? { ...s, title, updatedAt: now, turns: engineTurns.slice(-80) }
              : s,
          )
        : [
            {
              id: activeChatSessionId,
              title,
              updatedAt: now,
              turns: engineTurns.slice(-80),
            },
            ...cur,
          ];
      saveChatSessions(next);
      return next;
    });
  }, [engineTurns, activeChatSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  });

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) return;
    let live = true;
    fetchCoworkerMessages({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace.id,
      conversationId: activeChatSessionId,
    })
      .then((messages) => {
        if (!live || messages.length === 0) return;
        setEngineTurns(
          messages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) =>
              message.role === "user"
                ? {
                    kind: "user" as const,
                    id: message.id,
                    text: message.content,
                  }
                : {
                    kind: "assistant" as const,
                    id: message.id,
                    text: message.content,
                    tools: (message.toolCalls ?? []).map((tool, index) => ({
                      id: String(tool.id ?? `${message.id}-${index}`),
                      name: String(tool.name ?? tool.type ?? "tool"),
                      input:
                        typeof tool.input === "object" && tool.input
                          ? (tool.input as Record<string, unknown>)
                          : {},
                      status:
                        "ok" in tool && tool.ok === false
                          ? ("error" as const)
                          : ("ok" as const),
                      summary:
                        typeof tool.summary === "string" ? tool.summary : undefined,
                      output: tool.output,
                    })),
                    complete: true,
                  },
            ),
        );
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id, activeChatSessionId]);

  const conv: ConversationState | undefined =
    mode.kind === "conversation" ? conversations[mode.tab.id] : undefined;
  const fileDraft =
    mode.kind === "file-create"
      ? fileDrafts[mode.tab.id] ?? {
          format: "docx" as DocumentFormat,
          title: "",
          generating: false,
        }
      : null;

  const onAttach = async (list: FileList | null) => {
    if (!list || !currentOrganization) return;
    for (const file of Array.from(list)) {
      const id = `att-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setAttachments((cur) => [
        ...cur,
        { id, filename: file.name, uploading: true },
      ]);
      try {
        const uploaded = await uploadFile({
          file,
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace?.id,
          scope: "attachment",
          ownerKind: "prompt",
        });
        setAttachments((cur) =>
          cur.map((a) =>
            a.id === id ? { ...a, uploading: false, uploaded } : a,
          ),
        );
      } catch (err) {
        appendRunLog({
          level: "error",
          text: `Attach failed: ${(err as Error).message}`,
          source: "assistant",
        });
        setAttachments((cur) => cur.filter((a) => a.id !== id));
      }
    }
  };

  const stop = () => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const currentBuild = currentBuildRef.current;
    currentBuildRef.current = {};
    if (currentBuild.backgroundJobId) {
      void cancelBackgroundJob(currentBuild.backgroundJobId).catch(() => null);
    }
    if (currentBuild.requestId) {
      void rejectAiRequest(currentBuild.requestId, "Stopped by user").catch(() => null);
    }
    setBusy(false);
    setEngineTurns((cur) =>
      cur.map((t) =>
        t.kind === "assistant" && !t.complete
          ? { ...t, complete: true, text: t.text || "(stopped)" }
          : t,
      ),
    );
  };

  const startNewChat = () => {
    const id = newSessionId();
    const session: ChatSession = {
      id,
      title: "New chat",
      updatedAt: Date.now(),
      turns: [],
    };
    setChatSessions((cur) => {
      const next = [session, ...cur];
      saveChatSessions(next);
      return next;
    });
    setActiveChatSessionId(id);
    setEngineTurns([]);
    setPrompt("");
    setAttachments([]);
  };

  const openChatSession = (id: string) => {
    const session = chatSessions.find((s) => s.id === id);
    if (!session) return;
    setActiveChatSessionId(id);
    setEngineTurns(session.turns);
    setPrompt("");
    setAttachments([]);
  };

  const sendEngine = async () => {
    if (!currentOrganization || !currentWorkspace) return;
    const text = prompt.trim();
    if (!text) return;
    const userId = `u-${Date.now().toString(36)}`;
    const aId = `a-${Date.now().toString(36)}`;
    setEngineTurns((cur) => [
      ...cur,
      { kind: "user", id: userId, text },
      { kind: "assistant", id: aId, text: "", tools: [], complete: false },
    ]);
    setPrompt("");
    setAttachments([]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const operationId = operationRef.current + 1;
    operationRef.current = operationId;
    currentBuildRef.current = {};

    const history = engineTurns
      .slice(-12)
      .map((t) => ({
        role: t.kind === "user" ? ("user" as const) : ("assistant" as const),
        content: t.kind === "user" ? t.text : t.text,
      }))
      .filter((m) => m.content.trim().length > 0);

    const systemHint = activeTabHint(activeTab);
    const payload: EngineRunPayload = {
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace.id,
      systemId:
        activeTab?.kind === "system"
          ? activeTab.refId
          : activeTab?.parentRefId,
      prompt: text,
      history,
      systemHint,
      model: MODEL,
      autopilot,
    };

    try {
      const result = await coworkerChat({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        conversationId: activeChatSessionId,
        prompt: text,
        systemId: payload.systemId,
        systemHint,
        model: MODEL,
        autopilot,
      });
      if (operationRef.current !== operationId) return;
      setEngineTurns((cur) =>
        cur.map((t) =>
          t.kind === "assistant" && t.id === aId
            ? {
                ...t,
                text: result.message.content,
                complete: true,
                tools: result.toolCalls.map((tool, index) => ({
                  id: String(tool.id ?? `${result.message.id}-${index}`),
                  name: String(tool.name ?? tool.type ?? "tool"),
                  input:
                    typeof tool.input === "object" && tool.input
                      ? (tool.input as Record<string, unknown>)
                      : {},
                  status:
                    "ok" in tool && tool.ok === false
                      ? ("error" as const)
                      : ("ok" as const),
                  summary:
                    typeof tool.summary === "string" ? tool.summary : undefined,
                  output: tool.output,
                })),
              }
            : t,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Engine error.";
      setEngineTurns((cur) =>
        cur.map((t) =>
          t.kind === "assistant" && t.id === aId
            ? { ...t, text: t.text || `⚠ ${message}`, complete: true }
            : t,
        ),
      );
      appendRunLog({
        level: "error",
        text: `Assistant: ${message}`,
        source: "assistant",
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const sendConversation = async () => {
    if (mode.kind !== "conversation" || !currentOrganization || !conv) return;
    const text = prompt.trim();
    if (!text) return;
    const tabId = mode.tab.id;
    appendMessage(tabId, "user", text);
    setPrompt("");
    setConversationThinking(tabId, true);
    try {
      const transcript = [...conv.messages, { role: "user" as const, text }]
        .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text}`)
        .join("\n");
      const result = await chatWithAi({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        prompt: `${conv.preamble}\n\n--- conversation so far ---\n${transcript}\n\nReply as ASSISTANT.`,
        model: MODEL,
      });
      appendMessage(tabId, "assistant", result.answer);
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Chat failed: ${(err as Error).message}`,
        source: "assistant",
      });
      appendMessage(
        tabId,
        "assistant",
        "I had trouble reaching the model. Please try again.",
      );
    } finally {
      setConversationThinking(tabId, false);
    }
  };

  const sendFile = async () => {
    if (mode.kind !== "file-create" || !currentOrganization) return;
    const tabId = mode.tab.id;
    const draft = fileDrafts[tabId] ?? {
      format: "docx" as DocumentFormat,
      title: "",
      generating: false,
    };
    if (!draft.title.trim()) {
      appendRunLog({
        level: "warn",
        text: "Give the file a title before generating.",
        source: "files",
      });
      return;
    }
    setFileDraft(tabId, { generating: true });
    setRunOpen(true);
    appendRunLog({
      level: "info",
      text: `Generating ${draft.format.toUpperCase()} · ${draft.title}`,
      source: "files",
    });
    try {
      const doc = await generateDocument({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        format: draft.format,
        title: draft.title,
        prompt: prompt.trim() || undefined,
      });
      appendRunLog({
        level: "ok",
        text: `Created ${doc.filename}`,
        source: "files",
      });
      updateTab(tabId, { title: doc.filename, refId: doc.fileId });
      setPrompt("");
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Generation failed: ${(err as Error).message}`,
        source: "files",
      });
    } finally {
      setFileDraft(tabId, { generating: false });
    }
  };

  const send = () => {
    if (busy) return;
    if (mode.kind === "conversation") void sendConversation();
    else if (mode.kind === "file-create") void sendFile();
    else void sendEngine();
  };

  const finalizeConversation = async () => {
    if (mode.kind !== "conversation" || !conv) return;
    if (!currentOrganization || !currentWorkspace) return;
    const tabId = mode.tab.id;
    const transcript = conv.messages
      .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.text}`)
      .join("\n");
    setBusy(true);
    setRunOpen(true);
    try {
      if (mode.intent === "system") {
        appendRunLog({
          level: "info",
          text: "Drafting system from conversation…",
          source: "systems",
        });
        const aiPrompt = `Build a new business system based on this conversation. Synthesize the user's intent into a complete system with modules, entities, fields, and workflows.\n\n${transcript}`;
        const result = await createAiRequest({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
          prompt: aiPrompt,
          autoApply: true,
          context: { source: "system-conversation" },
        });
        const detail = await fetchAiRequest(result.request.id);
        await fetchAiRequestDiff(detail.id).catch(() => null);
        appendRunLog({
          level: "ok",
          text: "Coworker is building the system.",
          source: "systems",
        });
        navigate({
          kind: "plan",
          title: detail.summary ?? "System plan",
          refId: detail.id,
        });
      } else if (mode.intent === "job") {
        appendRunLog({
          level: "info",
          text: "Drafting job from conversation…",
          source: "coworker",
        });
        const ask = `From the conversation below, extract the job spec. Reply with a JSON object only (no prose) matching:
{"title": string (short, action-oriented), "instructions": string (clear, complete instructions for what the coworker should do each run), "triggerType": "manual"|"schedule", "triggerConfig": {"runAt": ISO-8601 string|null, "rrule": RFC5545 RRULE string|null}|null, "autopilot": boolean}
Pick triggerType="schedule" if the user mentioned recurring or a specific time; otherwise "manual". Use rrule for recurring (e.g. FREQ=WEEKLY;BYDAY=MO for "every Monday"). Default autopilot to true.

Conversation:
${transcript}`;
        const result = await chatWithAi({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
          prompt: ask,
        });
        const json = extractJson(result.answer);
        if (!json || !json.title || !json.instructions) {
          throw new Error("Could not extract job details.");
        }
        const tcRaw = (json.triggerConfig ?? null) as
          | { runAt?: string | null; rrule?: string | null }
          | null;
        const created = await createJob({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
          title: String(json.title),
          instructions: String(json.instructions),
          triggerType: ((json.triggerType as string) ?? "manual") as
            | "manual"
            | "schedule",
          triggerConfig: tcRaw
            ? { runAt: tcRaw.runAt ?? null, rrule: tcRaw.rrule ?? null }
            : undefined,
          autopilot: json.autopilot !== false,
        });
        appendRunLog({
          level: "ok",
          text: `Job "${created.title}" created${
            created.triggerType === "schedule" && created.nextRunAt
              ? ` — next run ${new Date(created.nextRunAt).toLocaleString()}`
              : "."
          }`,
          source: "coworker",
        });
        updateTab(tabId, { title: created.title, refId: created.id });
      } else if (mode.intent === "schedule") {
        const now = new Date().toISOString();
        const ask = `From the conversation below, extract the schedule details. Reply with a JSON object only (no prose):
{"title": string, "kind": "meeting"|"milestone"|"deadline"|"task"|"shift"|"reminder", "startsAt": ISO-8601 string, "endsAt": ISO-8601 string|null, "recurrenceRule": RFC5545 RRULE string|null, "metadata": object}
Today is ${now}. Convert relative times to absolute UTC ISO timestamps.

Conversation:
${transcript}`;
        const result = await chatWithAi({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
          prompt: ask,
        });
        const json = extractJson(result.answer);
        if (!json || !json.title || !json.startsAt) {
          throw new Error("Could not extract schedule details.");
        }
        const created = await createSchedule({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
          title: String(json.title),
          kind: typeof json.kind === "string" ? json.kind : "meeting",
          startsAt: new Date(String(json.startsAt)).toISOString(),
          endsAt: json.endsAt ? new Date(String(json.endsAt)).toISOString() : null,
          recurrenceRule:
            typeof json.recurrenceRule === "string"
              ? json.recurrenceRule
              : null,
          metadata:
            typeof json.metadata === "object" && json.metadata
              ? (json.metadata as Record<string, unknown>)
              : {},
        });
        appendRunLog({
          level: "ok",
          text: `Schedule "${created.title}" created`,
          source: "schedule",
        });
        updateTab(tabId, { title: created.title, refId: created.id });
      }
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Failed: ${(err as Error).message}`,
        source: "assistant",
      });
    } finally {
      setBusy(false);
    }
  };

  const userTurnsInConv = conv?.messages.filter((m) => m.role === "user").length ?? 0;
  const canFinalize = !!conv && userTurnsInConv >= 1 && !conv.thinking && !busy;

  const sendDisabled =
    busy ||
    (mode.kind === "conversation" && (conv?.thinking ?? false)) ||
    (mode.kind === "file-create" &&
      ((fileDraft?.generating ?? false) || !(fileDraft?.title ?? "").trim())) ||
    (mode.kind !== "file-create" && !prompt.trim());

  const headerInfo = headerForMode(mode);
  const HeaderIcon = headerInfo.icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-app bg-app-surface">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-app px-3 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">
        <HeaderIcon className="h-3 w-3 text-indigo-400" />
        <span className="truncate">{headerInfo.label}</span>
        <div className="ml-auto flex items-center gap-1">
          {mode.kind === "engine" && (
            <select
              value={activeChatSessionId}
              onChange={(e) => openChatSession(e.target.value)}
              className="h-6 max-w-[150px] rounded border border-app bg-app px-1.5 text-[10px] normal-case tracking-normal text-app-muted outline-none hover:border-app-strong"
              title="Chat history"
            >
              {chatSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title || "New chat"}
                </option>
              ))}
            </select>
          )}
          {mode.kind === "engine" && (
            <button
              onClick={startNewChat}
              className="grid h-6 w-6 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white"
              title="New chat"
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          {busy && mode.kind === "engine" && (
            <button
              onClick={stop}
              className="rounded px-1.5 py-0.5 text-[10px] text-app-muted hover:bg-white/10"
              title="Stop"
            >
              <StopCircle className="h-3 w-3" />
            </button>
          )}
          {mode.kind === "engine" && engineTurns.length > 0 && (
            <button
              onClick={() => {
                setEngineTurns([]);
                saveEngineHistory([]);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-app-faint hover:bg-white/10 hover:text-white"
              title="Clear conversation"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {mode.kind === "engine" ? (
          <EngineThread turns={engineTurns} busy={busy} />
        ) : mode.kind === "conversation" ? (
          <ConversationThread conv={conv} />
        ) : (
          <FileCreateHelp />
        )}
      </div>

      {mode.kind === "file-create" && fileDraft && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-app px-3 py-2">
          <select
            value={fileDraft.format}
            onChange={(e) =>
              setFileDraft(mode.tab.id, {
                format: e.target.value as DocumentFormat,
              })
            }
            className="rounded border border-app bg-app p-1.5 text-xs text-app"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            value={fileDraft.title}
            onChange={(e) =>
              setFileDraft(mode.tab.id, { title: e.target.value })
            }
            placeholder="File title"
            className="rounded border border-app bg-app p-1.5 text-xs text-app placeholder:text-app-faint"
          />
        </div>
      )}

      <div className="shrink-0 border-t border-app px-3 pb-3 pt-2">
        <div className="relative rounded-md border border-app bg-app focus-within:border-slate-600">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={headerInfo.placeholder}
            className="min-h-[72px] resize-none border-0 bg-transparent pb-9 text-xs text-white placeholder:text-app-faint focus-visible:ring-0 focus-visible:ring-offset-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void onAttach(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white"
              title="Attach file"
              type="button"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              onClick={send}
              disabled={sendDisabled}
              className="grid h-7 w-7 place-items-center rounded bg-indigo-500 text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-app-faint"
              title="Send (Ctrl+Enter)"
              type="button"
            >
              {busy ||
              (mode.kind === "file-create" && fileDraft?.generating) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
        {false && (
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10px]">
            <button
              type="button"
              onClick={() => setAutopilot(!autopilot)}
              className="flex items-center gap-1.5 text-app-subtle hover:text-white"
              title={
                autopilot
                  ? "Autopilot ON — coworker acts without asking each step"
                  : "Autopilot OFF — coworker confirms destructive actions"
              }
            >
              <span
                className={`relative inline-block h-3 w-6 rounded-full transition ${
                  autopilot ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${
                    autopilot ? "left-3.5" : "left-0.5"
                  }`}
                />
              </span>
              <span className="uppercase tracking-wider">
                {autopilot ? "" : ""}
              </span>
            </button>
            <span className="text-app-faint">
              Ctrl+Enter to send
            </span>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1 rounded bg-app-elevated px-2 py-0.5 text-[11px] text-app-muted"
              >
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[110px] truncate">{a.filename}</span>
                {a.uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <button
                    onClick={() =>
                      setAttachments((cur) =>
                        cur.filter((x) => x.id !== a.id),
                      )
                    }
                    className="text-app-faint hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {false && mode.kind === "conversation" && (
          <button
            onClick={() => void finalizeConversation()}
            disabled={!canFinalize}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-emerald-500/15 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:bg-app-elevated disabled:text-app-faint"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {mode.intent === "system"
              ? ""
              : mode.intent === "job"
              ? ""
              : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function EngineThread({
  turns,
  busy,
}: {
  turns: EngineTurn[];
  busy: boolean;
}) {
  if (turns.length === 0) {
    return (
      <p className="px-1 py-2 text-[11px] text-app-faint">
        Ask the coworker to build a system, summarize or rewrite a document,
        create tasks, generate reports, find files, schedule meetings, draft
        messages, review progress, or answer questions from company files.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {turns.map((t) => (
        <Turn key={t.id} turn={t} />
      ))}
      {busy && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-app-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> Working…
        </div>
      )}
    </div>
  );
}

function ConversationThread({ conv }: { conv: ConversationState | undefined }) {
  if (!conv) {
    return (
      <div className="grid place-items-center py-12 text-xs text-app-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {conv.messages.map((m, i) => (
        <Bubble key={i} role={m.role} text={m.text} />
      ))}
      {conv.thinking && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-app-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
        </div>
      )}
    </div>
  );
}

function FileCreateHelp() {
  return (
    <p className="px-1 py-2 text-[11px] text-app-faint">
      Pick a format and title below, then describe what the file should
      contain. Send to generate.
    </p>
  );
}

function Turn({ turn }: { turn: EngineTurn }) {
  if (turn.kind === "user") {
    return <Bubble role="user" text={turn.text} />;
  }
  return (
    <div className="flex gap-2">
      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-app-elevated text-app-muted">
        <Bot className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {turn.tools.map((s) => (
          <ToolBubble key={s.id} step={s} />
        ))}
        {turn.text && (
          <div className="whitespace-pre-wrap rounded bg-app-surface px-2 py-1.5 text-xs text-app">
            {turn.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
          isUser
            ? "bg-indigo-500/20 text-indigo-300"
            : "bg-app-elevated text-app-muted"
        }`}
      >
        {isUser ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
      </div>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded px-2 py-1.5 text-xs leading-relaxed ${
          isUser
            ? "bg-indigo-500/15 text-white"
            : "bg-app-surface text-app"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function ToolBubble({ step }: { step: ToolStep }) {
  const [expanded, setExpanded] = useState(false);
  const Icon =
    step.status === "running" ? Loader2 : step.status === "ok" ? Check : X;
  const color =
    step.status === "running"
      ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
      : step.status === "ok"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : "text-rose-300 border-rose-500/30 bg-rose-500/10";
  return (
    <div className={`rounded border ${color} px-2 py-1 text-[11px]`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="font-mono text-[10px]">{step.name}</span>
        <span className="min-w-0 flex-1 truncate text-app-subtle">
          {step.summary ?? ""}
        </span>
        <Icon
          className={`h-3 w-3 shrink-0 ${
            step.status === "running" ? "animate-spin" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-t border-white/10 pt-1.5 text-[10px]">
          {Object.keys(step.input ?? {}).length > 0 && (
            <div>
              <div className="mb-0.5 text-app-faint">input</div>
              <pre className="max-h-32 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-app-muted">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}
          {step.output !== undefined && (
            <div>
              <div className="mb-0.5 text-app-faint">output</div>
              <pre className="max-h-32 overflow-auto rounded bg-slate-950/60 p-1.5 font-mono text-emerald-200">
                {typeof step.output === "string"
                  ? step.output
                  : JSON.stringify(step.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function updateEngineTurnFromEvent(
  setTurns: React.Dispatch<React.SetStateAction<EngineTurn[]>>,
  assistantId: string,
  event: EngineEvent,
) {
  setTurns((cur) =>
    cur.map((t) => {
      if (t.kind !== "assistant" || t.id !== assistantId) return t;
      switch (event.type) {
        case "message.complete":
          return { ...t, text: event.text || t.text };
        case "tool.call":
          return {
            ...t,
            tools: [
              ...t.tools,
              {
                id: event.id,
                name: event.name,
                input: event.input,
                status: "running",
              },
            ],
          };
        case "tool.result":
          return {
            ...t,
            tools: t.tools.map((s) =>
              s.id === event.id
                ? {
                    ...s,
                    status: event.ok ? "ok" : "error",
                    summary: event.summary,
                    output: event.output,
                  }
                : s,
            ),
          };
        case "session.complete":
          return { ...t, complete: true };
        case "session.error":
          return {
            ...t,
            complete: true,
            text: t.text || `⚠ ${event.message}`,
          };
        default:
          return t;
      }
    }),
  );
}

async function monitorBuildProgress(
  requestId: string,
  backgroundJobId: string | undefined,
  assistantId: string,
  setTurns: React.Dispatch<React.SetStateAction<EngineTurn[]>>,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  organizationId: string,
  workspaceId: string,
  navigate: ReturnType<typeof useWorkspace>["navigate"],
  appendRunLog: ReturnType<typeof useWorkspace>["appendRunLog"],
  isCurrentOperation: () => boolean,
) {
  try {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (!isCurrentOperation()) return;
      await sleep(attempt === 0 ? 700 : 1500);
      if (!isCurrentOperation()) return;
      try {
        const [detail, job] = await Promise.all([
          fetchAiRequest(requestId),
          backgroundJobId ? fetchJob(backgroundJobId).catch(() => null) : null,
        ]);
        const rawSteps = Array.isArray(detail.metadata?.steps)
          ? (detail.metadata.steps as Array<{
              ts?: string;
              type?: string;
              message?: string;
              data?: unknown;
            }>)
          : [];

        for (const step of rawSteps) {
          const key = `${step.ts ?? ""}:${step.type ?? ""}:${step.message ?? ""}`;
          if (seen.has(key) || !step.message) continue;
          seen.add(key);
          appendSyntheticToolStep(setTurns, assistantId, {
            id: `build-${seen.size}-${requestId}`,
            name: "coworker.build",
            input: {},
            status: step.type === "error" ? "error" : "ok",
            summary: step.message,
            output: step.data,
          });
        }

        const terminal =
          detail.status === "applied" ||
          detail.status === "completed" ||
          detail.status === "failed" ||
          job?.status === "completed" ||
          job?.status === "failed";
        if (terminal) {
          const failed = detail.status === "failed" || job?.status === "failed";
          appendBuildFinal(setTurns, assistantId, failed, detail, job?.errorMessage);
          if (!failed && detail.appliedSystemId) {
            await generateDeployAndOpenPreview({
              systemId: detail.appliedSystemId,
              organizationId,
              workspaceId,
              prompt: detail.prompt,
              assistantId,
              setTurns,
              navigate,
              appendRunLog,
              isCurrentOperation,
            });
          }
          return;
        }
      } catch (err) {
        appendSyntheticToolStep(setTurns, assistantId, {
          id: `build-poll-error-${requestId}`,
          name: "coworker.build",
          input: {},
          status: "error",
          summary:
            err instanceof Error ? err.message : "Could not read build progress.",
        });
        return;
      }
    }

    appendSyntheticToolStep(setTurns, assistantId, {
      id: `build-timeout-${requestId}`,
      name: "coworker.build",
      input: {},
      status: "running",
      summary: "Still building in the background.",
    });
  } finally {
    setBusy(false);
  }
}

async function generateDeployAndOpenPreview({
  systemId,
  organizationId,
  workspaceId,
  prompt,
  assistantId,
  setTurns,
  navigate,
  appendRunLog,
  isCurrentOperation,
}: {
  systemId: string;
  organizationId: string;
  workspaceId: string;
  prompt: string;
  assistantId: string;
  setTurns: React.Dispatch<React.SetStateAction<EngineTurn[]>>;
  navigate: ReturnType<typeof useWorkspace>["navigate"];
  appendRunLog: ReturnType<typeof useWorkspace>["appendRunLog"];
  isCurrentOperation: () => boolean;
}) {
  let repairContext = "";
  appendSyntheticToolStep(setTurns, assistantId, {
    id: `preview-generate-${systemId}`,
    name: "runner.generate",
    input: { systemId },
    status: "running",
    summary: "Generating runnable preview app...",
  });
  try {
    let readyDeployment: Awaited<ReturnType<typeof fetchDeployment>> | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!isCurrentOperation()) return;
      const attemptPrompt =
        repairContext.length === 0
          ? prompt
          : [
              prompt,
              "",
              "The previous generated preview failed during Stack62 coworker testing.",
              "Repair the generated app so it boots cleanly, passes GET /health, and works for a non-technical business user.",
              "Use the error logs below as the debugging source:",
              repairContext,
            ].join("\n");

      appendSyntheticToolStep(setTurns, assistantId, {
        id: `preview-generate-${systemId}-${attempt}`,
        name: "runner.generate",
        input: { systemId, attempt },
        status: "running",
        summary:
          attempt === 1
            ? "Creating the runnable app..."
            : `Repairing the app from test logs (attempt ${attempt})...`,
      });
      const generated = await generateSystemCode({
        systemId,
        organizationId,
        workspaceId,
        prompt: attemptPrompt,
        model: MODEL,
      });
      if (!isCurrentOperation()) return;
      appendSyntheticToolStep(setTurns, assistantId, {
        id: `preview-generated-${systemId}-${attempt}`,
        name: "runner.generate",
        input: { systemId, attempt },
        status: "ok",
        summary: `Prepared ${generated.fileCount} preview file${generated.fileCount === 1 ? "" : "s"}.`,
        output: generated.files,
      });

      appendSyntheticToolStep(setTurns, assistantId, {
        id: `preview-deploy-${systemId}-${attempt}`,
        name: "runner.deploy",
        input: { systemId, attempt },
        status: "running",
        summary: "Testing and deploying preview...",
      });
      const deployment = await deploySystem({
        systemId,
        organizationId,
        workspaceId,
        entrypoint: generated.entrypoint,
        runtime: generated.runtime,
      });
      readyDeployment = await waitForDeployment(deployment.id);
      if (!isCurrentOperation()) return;
      if (readyDeployment.status === "running") {
        appendSyntheticToolStep(setTurns, assistantId, {
          id: `preview-deployed-${systemId}-${attempt}`,
          name: "runner.deploy",
          input: { systemId, attempt },
          status: "ok",
          summary: `Preview passed coworker checks and is running.`,
          output: {
            deploymentId: readyDeployment.id,
            status: readyDeployment.status,
            port: readyDeployment.port,
          },
        });
        break;
      }

      const logText = await summarizeDeploymentFailure(readyDeployment);
      repairContext = logText;
      appendSyntheticToolStep(setTurns, assistantId, {
        id: `preview-repair-${systemId}-${attempt}`,
        name: "coworker.debug",
        input: { systemId, attempt },
        status: attempt < 3 ? "running" : "error",
        summary:
          attempt < 3
            ? "The preview failed internal testing. I am reading the logs and fixing it before you test."
            : "The preview still failed after automatic repair attempts.",
        output: {
          deploymentId: readyDeployment.id,
          status: readyDeployment.status,
          errorMessage: readyDeployment.errorMessage,
          logs: logText,
        },
      });
    }

    if (!readyDeployment || readyDeployment.status !== "running") {
      throw new Error(
        readyDeployment?.errorMessage ??
          "The coworker could not produce a running preview after repair attempts.",
      );
    }
    appendRunLog({
      level: "ok",
      text: `Preview deployment ${readyDeployment.id.slice(0, 8)} running`,
      source: "runner",
    });
    navigate(
      {
        kind: "preview",
        title: "Preview",
        refId: systemId,
      },
      { newTab: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview deploy failed.";
    appendSyntheticToolStep(setTurns, assistantId, {
      id: `preview-failed-${systemId}`,
      name: "runner.deploy",
      input: { systemId },
      status: "error",
      summary: `I could not finish the automatic repair loop yet: ${message}`,
    });
    appendRunLog({
      level: "error",
      text: `Coworker repair loop stopped: ${message}`,
      source: "runner",
    });
  }
}

async function summarizeDeploymentFailure(
  deployment: Awaited<ReturnType<typeof fetchDeployment>>,
) {
  const logs = await fetchDeploymentLogs(deployment.id, 120).catch(() => ({
    lines: [] as string[],
  }));
  const lines = logs.lines.slice(-80).join("\n").slice(-6000);
  return [
    `Deployment ${deployment.id} ended as ${deployment.status}.`,
    deployment.errorMessage ? `Error: ${deployment.errorMessage}` : "",
    lines ? `Logs:\n${lines}` : "No deployment logs were available.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function waitForDeployment(deploymentId: string) {
  let latest = await fetchDeployment(deploymentId);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (latest.status === "running" || latest.status === "crashed" || latest.status === "stopped") {
      return latest;
    }
    await sleep(attempt < 5 ? 1000 : 2000);
    latest = await fetchDeployment(deploymentId);
  }
  return latest;
}

function appendSyntheticToolStep(
  setTurns: React.Dispatch<React.SetStateAction<EngineTurn[]>>,
  assistantId: string,
  step: ToolStep,
) {
  setTurns((cur) =>
    cur.map((turn) =>
      turn.kind === "assistant" && turn.id === assistantId
        ? {
            ...turn,
            complete: false,
            tools: turn.tools.some((existing) => existing.id === step.id)
              ? turn.tools
              : [...turn.tools, step],
          }
        : turn,
    ),
  );
}

function appendBuildFinal(
  setTurns: React.Dispatch<React.SetStateAction<EngineTurn[]>>,
  assistantId: string,
  failed: boolean,
  detail: Awaited<ReturnType<typeof fetchAiRequest>>,
  errorMessage?: string | null,
) {
  const text = failed
    ? `I could not finish the build: ${detail.summary ?? errorMessage ?? "the background job failed."}`
    : `Built and applied: ${detail.summary ?? "your requested system is ready."}`;
  setTurns((cur) =>
    cur.map((turn) =>
      turn.kind === "assistant" && turn.id === assistantId
        ? { ...turn, text, complete: true }
        : turn,
    ),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function headerForMode(mode: DockMode): {
  label: string;
  icon: LucideIcon;
  placeholder: string;
} {
  if (mode.kind === "conversation") {
    if (mode.intent === "system")
      return {
        label: "Describe the system",
        icon: Sparkles,
        placeholder: "Tell me about the system you want to build…",
      };
    if (mode.intent === "job")
      return {
        label: "Describe the job",
        icon: Bot,
        placeholder: "Tell me what the coworker should do, and when…",
      };
    return {
      label: "Describe the schedule",
      icon: Calendar,
      placeholder: "What needs to happen, and when?",
    };
  }
  if (mode.kind === "file-create") {
    return {
      label: "Generate a file",
      icon: FileText,
      placeholder: "What should the document contain?",
    };
  }
  return {
    label: "Assistant",
    icon: Sparkles,
    placeholder: "Ask the assistant to do something for you…",
  };
}

function activeTabHint(activeTab: ReturnType<typeof useWorkspace>["activeTab"]) {
  if (!activeTab) return undefined;
  if (activeTab.kind === "system" && activeTab.refId)
    return `The user is viewing system ${activeTab.refId}.`;
  if (activeTab.kind === "module" && activeTab.refId)
    return `The user is viewing module ${activeTab.refId} in system ${activeTab.parentRefId}.`;
  if (activeTab.kind === "record" && activeTab.refId)
    return `The user is viewing record ${activeTab.refId}.`;
  if (activeTab.kind === "plan" && activeTab.refId)
    return `The user is viewing plan ${activeTab.refId}.`;
  if (activeTab.kind === "job" && activeTab.refId)
    return `The user is viewing coworker job ${activeTab.refId}.`;
  return undefined;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
