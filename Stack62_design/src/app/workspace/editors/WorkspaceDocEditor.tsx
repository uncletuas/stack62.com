import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  AlertCircle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  ListChecks,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getStoredToken } from "../../lib/api";
import {
  fetchWorkspaceDoc,
  getWorkspaceRealtimeUrl,
  type WorkspaceDocKind,
} from "../../lib/resources";
import { useAppContext } from "../../context/app-context";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { WorkspaceActivityPanel } from "./workspace-surfaces/WorkspaceActivityPanel";
import { WorkspaceSheetSurface } from "./workspace-surfaces/WorkspaceSheetSurface";
import { WorkspaceSlidesSurface } from "./workspace-surfaces/WorkspaceSlidesSurface";

/**
 * The collaborative, AI-native document editor.
 *
 * Architecture in one paragraph: TipTap renders ProseMirror. A Y.Doc
 * holds the canonical state. `HocuspocusProvider` syncs the Y.Doc to
 * Stack62's backend over `wss://…/v1/realtime/workspace`. The
 * `@tiptap/extension-collaboration` extension binds the editor to
 * the Y.Doc, so typing in this editor becomes Yjs updates the
 * server broadcasts to every other connected client. AI actions
 * land via the REST `dispatch_action` endpoint, which mutates the
 * same Y.Doc on the server and broadcasts back to the editor —
 * the AI's edits *appear* in the user's editor as if a teammate
 * typed them, because at the Yjs layer that's exactly what happened.
 *
 * One non-obvious thing: we deliberately do NOT include
 * `StarterKit.history` because Yjs handles undo/redo through
 * `Collaboration` (which uses `Y.UndoManager`). Mixing the two
 * gives you "ghost undo" bugs where ⌘Z reverts edits the local
 * user didn't make. StarterKit's history is opted out below.
 */
export function WorkspaceDocEditor({ tab }: { tab: EditorTab }) {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, updateTab } = useWorkspace();

  const docId = tab.refId;

  // Fetch the doc's kind so we can route to the right surface
  // (document → TipTap, sheet → AG Grid, slides → Konva next turn).
  // We start as null and switch when the fetch resolves; until then
  // the editor shows a connecting state inside whatever surface we
  // can guess from the tab title heuristic ("Sheet" / "Presentation").
  const [docKind, setDocKind] = useState<WorkspaceDocKind | null>(null);
  useEffect(() => {
    if (!docId) return;
    let alive = true;
    void fetchWorkspaceDoc(docId)
      .then((d) => {
        if (alive) setDocKind(d.kind);
      })
      .catch(() => {
        // Fall back to inferring from the tab title — set in
        // openIntentToRoute when the chat chip is clicked.
        if (alive) {
          const t = (tab.title ?? "").toLowerCase();
          setDocKind(
            t.includes("sheet") || t.includes("spreadsheet")
              ? "sheet"
              : t.includes("presentation") || t.includes("slide")
                ? "slides"
                : "document",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [docId, tab.title]);

  // The Y.Doc lives for the lifetime of the tab. `useMemo` with a
  // tab.id-keyed reset means switching docs gets a fresh Y.Doc; the
  // old one is collected when its provider is destroyed below.
  const ydoc = useMemo(() => new Y.Doc(), [tab.id, docId]);

  const [providerStatus, setProviderStatus] = useState<
    "connecting" | "connected" | "disconnected" | "authError"
  >("connecting");
  const [peerCount, setPeerCount] = useState(0);
  const [docTitle, setDocTitle] = useState<string>(tab.title ?? "Untitled");
  // Activity panel toggle (closed by default — it's a side rail).
  const [showActivity, setShowActivity] = useState(false);
  // Page size — controls visual page-break boundaries in the doc
  // canvas. Letter is the US default; A4 covers the rest of the world.
  // The editor's content flows naturally; we draw horizontal break
  // lines every page-height to give the visual feel of pages.
  const [pageSize, setPageSize] = useState<"letter" | "a4" | "legal">(
    "letter",
  );
  // "Coworker just edited" badge state. Set when the activity panel
  // reports the latest action was by a coworker within the last 15s.
  const [aiBadge, setAiBadge] = useState<{ occurredAt: string } | null>(null);
  useEffect(() => {
    if (!aiBadge) return;
    // Auto-clear after 15 seconds — long enough to notice, short
    // enough to not dominate the header.
    const ms = 15000 - (Date.now() - new Date(aiBadge.occurredAt).getTime());
    if (ms <= 0) {
      setAiBadge(null);
      return;
    }
    const id = window.setTimeout(() => setAiBadge(null), ms);
    return () => window.clearTimeout(id);
  }, [aiBadge]);
  const providerRef = useRef<HocuspocusProvider | null>(null);

  // ── Hocuspocus provider lifecycle ────────────────────────────────
  useEffect(() => {
    if (!docId) return;
    const token = getStoredToken();
    if (!token) {
      setProviderStatus("authError");
      return;
    }
    const provider = new HocuspocusProvider({
      url: getWorkspaceRealtimeUrl(),
      name: docId,
      token,
      document: ydoc,
      onAuthenticationFailed: ({ reason }) => {
        appendRunLog({
          level: "error",
          text: `Realtime auth failed: ${reason}`,
          source: "workspace-doc",
        });
        setProviderStatus("authError");
      },
      onStatus: ({ status }) => {
        if (status === "connected") setProviderStatus("connected");
        else if (status === "disconnected") setProviderStatus("disconnected");
        else setProviderStatus("connecting");
      },
      onAwarenessUpdate: ({ states }) => {
        // States is an array of every connected client. Subtract 1
        // for self so "Others online" reads naturally.
        setPeerCount(Math.max(0, states.length - 1));
      },
    });
    providerRef.current = provider;

    // Identify this user to other clients (drives the colored
    // selection cursor in CollaborationCursor).
    if (user) {
      provider.setAwarenessField("user", {
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        color: hashColor(user.id),
      });
    }

    return () => {
      provider.destroy();
      providerRef.current = null;
    };
  }, [docId, ydoc, user, appendRunLog]);

  // ── TipTap editor ────────────────────────────────────────────────
  const editor = useEditor(
    {
      extensions: [
        // history is owned by Yjs (Collaboration extension below).
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: ydoc, field: "content" }),
        ...(providerRef.current
          ? [
              CollaborationCursor.configure({
                provider: providerRef.current,
                user: {
                  name:
                    user?.firstName ?
                      `${user.firstName} ${user.lastName}`.trim()
                    : (user?.email ?? "User"),
                  color: user ? hashColor(user.id) : "#6b7280",
                },
              }),
            ]
          : []),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder:
            providerStatus === "connected"
              ? "Start typing — your Coworker can also edit alongside you."
              : "Connecting…",
        }),
      ],
      editorProps: {
        attributes: {
          class: "workspace-doc-prose prose max-w-none focus:outline-none",
        },
      },
      // The Yjs binding will hydrate content from the synced doc.
    },
    [ydoc, providerRef.current],
  );

  // Pull title from the Y.Doc's meta map and react to remote changes.
  useEffect(() => {
    const meta = ydoc.getMap("meta");
    const refresh = () => {
      const t = meta.get("title");
      if (typeof t === "string" && t && t !== docTitle) {
        setDocTitle(t);
        updateTab(tab.id, { title: t });
      }
    };
    refresh();
    meta.observe(refresh);
    return () => meta.unobserve(refresh);
  }, [ydoc, tab.id, updateTab, docTitle]);

  if (!docId) {
    return (
      <EmptyMessage
        icon={AlertCircle}
        text="No document selected. Ask Coworker to create a workspace doc, or pick one from the workspace tab."
      />
    );
  }

  // ── Kind-router ───────────────────────────────────────────────
  // The header + provider lifecycle are shared. The body switches
  // between TipTap (document), AG Grid (sheet), and a placeholder
  // for slides until turn 5 ships the Konva surface.
  const body = (() => {
    if (!docKind) {
      return (
        <div className="grid h-full place-items-center text-sm text-app-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      );
    }
    if (docKind === "sheet") {
      return (
        <WorkspaceSheetSurface
          docId={docId}
          ydoc={ydoc}
          provider={providerRef.current}
          organizationId={currentOrganization?.id ?? ""}
          workspaceId={currentWorkspace?.id ?? ""}
        />
      );
    }
    if (docKind === "slides") {
      return (
        <WorkspaceSlidesSurface
          docId={docId}
          ydoc={ydoc}
          provider={providerRef.current}
          organizationId={currentOrganization?.id ?? ""}
          workspaceId={currentWorkspace?.id ?? ""}
        />
      );
    }
    // Default: document → TipTap with visual page breaks
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-[#f1f3f4] py-6">
        <div
          className="mx-auto bg-white shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
          data-page-size={pageSize}
          style={{
            // Page width in CSS inches — browsers map this to the
            // user's effective DPI. Looks like a piece of paper at
            // any zoom.
            width: pageSize === "a4" ? "8.27in" : "8.5in",
            // Minimum height of one page; content can flow past
            // this and the visual page-break gradient marks the
            // boundary between pages.
            minHeight:
              pageSize === "a4"
                ? "11.69in"
                : pageSize === "legal"
                  ? "14in"
                  : "11in",
            padding: "1in 1in",
            // Repeating linear-gradient draws a 24px-tall light-gray
            // strip every page-height to simulate the gap between
            // physical pages. Doesn't break the editor's contiguous
            // contenteditable — content still flows freely.
            backgroundImage:
              pageSize === "a4"
                ? "repeating-linear-gradient(to bottom, transparent 0, transparent calc(11.69in - 2px), #d0d4d8 calc(11.69in - 2px), #d0d4d8 calc(11.69in + 2px), #f1f3f4 calc(11.69in + 2px), #f1f3f4 calc(11.69in + 22px), transparent calc(11.69in + 22px))"
                : pageSize === "legal"
                  ? "repeating-linear-gradient(to bottom, transparent 0, transparent calc(14in - 2px), #d0d4d8 calc(14in - 2px), #d0d4d8 calc(14in + 2px), #f1f3f4 calc(14in + 2px), #f1f3f4 calc(14in + 22px), transparent calc(14in + 22px))"
                  : "repeating-linear-gradient(to bottom, transparent 0, transparent calc(11in - 2px), #d0d4d8 calc(11in - 2px), #d0d4d8 calc(11in + 2px), #f1f3f4 calc(11in + 2px), #f1f3f4 calc(11in + 22px), transparent calc(11in + 22px))",
            backgroundRepeat: "repeat-y",
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  })();

  return (
    <div className="flex h-full flex-col bg-[#f8f9fa] text-[#1f1f1f]">
      <Header
        title={docTitle}
        providerStatus={providerStatus}
        peerCount={peerCount}
        aiBadge={aiBadge}
        activityOpen={showActivity}
        onToggleActivity={() => setShowActivity((v) => !v)}
      />
      {docKind === "document" && editor && (
        <Toolbar editor={editor} pageSize={pageSize} setPageSize={setPageSize} />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        <WorkspaceActivityPanel
          docId={docId}
          open={showActivity}
          onClose={() => setShowActivity(false)}
          onLatestActor={(info) => {
            if (!info) return;
            // Show the AI badge only for fresh coworker actions.
            if (info.actorKind !== "coworker") return;
            const ageMs = Date.now() - new Date(info.occurredAt).getTime();
            if (ageMs < 15000) {
              setAiBadge({ occurredAt: info.occurredAt });
            }
          }}
        />
      </div>
      <style>{`
        .workspace-doc-prose { font-size: 14px; line-height: 1.65; color: #1f1f1f; min-height: 60vh; }
        .workspace-doc-prose h1 { font-size: 1.75em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .workspace-doc-prose h2 { font-size: 1.4em; font-weight: 700; margin: 0.6em 0 0.3em; }
        .workspace-doc-prose h3 { font-size: 1.2em; font-weight: 600; margin: 0.6em 0 0.3em; }
        .workspace-doc-prose p { margin: 0.4em 0; }
        .workspace-doc-prose ul, .workspace-doc-prose ol { padding-left: 1.6em; margin: 0.4em 0; }
        .workspace-doc-prose li { margin: 0.15em 0; }
        .workspace-doc-prose ul[data-type="taskList"] { list-style: none; padding-left: 0; }
        .workspace-doc-prose ul[data-type="taskList"] li {
          display: flex;
          gap: 0.5em;
          align-items: flex-start;
        }
        .workspace-doc-prose ul[data-type="taskList"] li > label { user-select: none; }
        .workspace-doc-prose blockquote {
          border-left: 3px solid #c4c7c5;
          padding: 0.2em 0.8em;
          margin: 0.6em 0;
          color: #5f6368;
        }
        .workspace-doc-prose pre {
          background: #f1f3f4;
          padding: 0.8em;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.9em;
          margin: 0.6em 0;
          overflow-x: auto;
        }
        .workspace-doc-prose code {
          background: #f1f3f4;
          padding: 0.1em 0.3em;
          border-radius: 3px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.92em;
        }
        .workspace-doc-prose a { color: #1a73e8; text-decoration: underline; }
        .workspace-doc-prose p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
        /* Collaboration cursor */
        .collaboration-cursor__caret {
          border-left: 1px solid;
          border-right: 1px solid;
          margin-left: -1px;
          margin-right: -1px;
          pointer-events: none;
          position: relative;
          word-break: normal;
        }
        .collaboration-cursor__label {
          font-size: 11px;
          font-weight: 600;
          padding: 0 4px;
          border-radius: 3px;
          position: absolute;
          top: -1.3em;
          left: -1px;
          white-space: nowrap;
          color: white;
        }
      `}</style>
    </div>
  );
}

// ── Header strip ─────────────────────────────────────────────────

function Header({
  title,
  providerStatus,
  peerCount,
  aiBadge,
  activityOpen,
  onToggleActivity,
}: {
  title: string;
  providerStatus: string;
  peerCount: number;
  aiBadge: { occurredAt: string } | null;
  activityOpen: boolean;
  onToggleActivity: () => void;
}) {
  const statusTone =
    providerStatus === "connected"
      ? "text-emerald-600"
      : providerStatus === "connecting"
        ? "text-amber-500"
        : "text-rose-500";
  const statusText =
    providerStatus === "connected"
      ? "Live"
      : providerStatus === "connecting"
        ? "Connecting…"
        : providerStatus === "authError"
          ? "Auth failed"
          : "Offline";
  return (
    <div className="flex items-center justify-between border-b border-app bg-app-surface px-4 py-2 text-xs">
      <div className="flex items-center gap-2 truncate">
        <span className="truncate font-medium text-app">{title}</span>
        {aiBadge && (
          <span
            className="inline-flex animate-pulse items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300"
            title={`Last edit by Coworker at ${new Date(aiBadge.occurredAt).toLocaleTimeString()}`}
          >
            <Sparkles className="h-2.5 w-2.5" /> Coworker just edited
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <button
          type="button"
          onClick={onToggleActivity}
          title={activityOpen ? "Hide activity" : "Show activity"}
          className={`flex items-center gap-1 rounded p-1 transition ${
            activityOpen
              ? "bg-accent-soft text-accent"
              : "text-app-muted hover:bg-app-hover"
          }`}
        >
          <ListChecks className="h-3 w-3" />
          <span className="hidden sm:inline">Activity</span>
        </button>
        <span className={statusTone}>● {statusText}</span>
        {peerCount > 0 && (
          <span className="flex items-center gap-1 text-app-muted">
            <Users className="h-3 w-3" /> {peerCount}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────

function Toolbar({
  editor,
  pageSize,
  setPageSize,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  pageSize: "letter" | "a4" | "legal";
  setPageSize: (size: "letter" | "a4" | "legal") => void;
}) {
  // The toolbar mounts inside the same chrome strip as the header.
  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-app bg-app-surface px-2 py-1 text-[12px]"
      onMouseDown={(e) => {
        if (
          e.target instanceof HTMLElement &&
          !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)
        ) {
          e.preventDefault();
        }
      }}
    >
      <Btn icon={Undo2} label="Undo" onClick={() => editor.chain().focus().undo().run()} />
      <Btn icon={Redo2} label="Redo" onClick={() => editor.chain().focus().redo().run()} />
      <Sep />

      <select
        value={
          editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : editor.isActive("blockquote")
                  ? "blockquote"
                  : editor.isActive("codeBlock")
                    ? "code"
                    : "p"
        }
        onChange={(e) => {
          const v = e.target.value;
          const c = editor.chain().focus();
          if (v === "p") c.setParagraph().run();
          else if (v === "h1") c.toggleHeading({ level: 1 }).run();
          else if (v === "h2") c.toggleHeading({ level: 2 }).run();
          else if (v === "h3") c.toggleHeading({ level: 3 }).run();
          else if (v === "blockquote") c.toggleBlockquote().run();
          else if (v === "code") c.toggleCodeBlock().run();
        }}
        className="h-7 rounded border border-app bg-app px-1 text-[11px] focus:outline-none"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="blockquote">Quote</option>
        <option value="code">Code</option>
      </select>

      <Sep />

      <Btn
        icon={Bold}
        label="Bold (⌘B)"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <Btn
        icon={Italic}
        label="Italic (⌘I)"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <Btn
        icon={UnderlineIcon}
        label="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleMark("underline").run()}
      />
      <Btn
        icon={Strikethrough}
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />

      <Sep />

      <Btn
        icon={List}
        label="Bulleted list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <Btn
        icon={ListOrdered}
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Btn
        icon={ListTodo}
        label="Task list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Btn
        icon={Quote}
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />

      <Sep />

      <Btn icon={AlignLeft} label="Align left" onClick={() => editor.chain().focus().setTextAlign?.("left").run()} />
      <Btn icon={AlignCenter} label="Align center" onClick={() => editor.chain().focus().setTextAlign?.("center").run()} />
      <Btn icon={AlignRight} label="Align right" onClick={() => editor.chain().focus().setTextAlign?.("right").run()} />

      <Sep />

      <Btn
        icon={Link2}
        label="Insert link"
        active={editor.isActive("link")}
        onClick={() => {
          const url = window.prompt("Link URL", editor.getAttributes("link").href ?? "https://");
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().setLink({ href: url }).run();
        }}
      />

      <div className="ml-auto flex items-center gap-2 pr-1">
        <select
          value={pageSize}
          onChange={(e) =>
            setPageSize(e.target.value as "letter" | "a4" | "legal")
          }
          className="h-7 rounded border border-app bg-app px-1 text-[11px]"
          title="Page size"
        >
          <option value="letter">Letter</option>
          <option value="a4">A4</option>
          <option value="legal">Legal</option>
        </select>
      </div>
    </div>
  );
}

function Btn({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded transition ${
        active ? "bg-accent-soft text-accent" : "text-app-muted hover:bg-app-hover"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-app" />;
}

function EmptyMessage({
  icon: Icon,
  text,
}: {
  icon: LucideIcon;
  text: string;
}) {
  return (
    <div className="grid h-full place-items-center bg-app text-center text-sm text-app-faint">
      <div className="max-w-md space-y-2 px-6">
        <Icon className="mx-auto h-6 w-6 text-app-faint" />
        <p>{text}</p>
        <p className="text-[11px] text-app-faint">
          <Loader2 className="mr-1 inline-block h-3 w-3 animate-spin align-text-bottom" />
          Tip: type "create a workspace doc titled 'My report'" into the Coworker chat.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Stable color per user — drives the collaboration cursor's
 * coloured selection range so each teammate has a consistent hue
 * across sessions.
 */
function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = [
    "#1a73e8",
    "#34a853",
    "#a142f4",
    "#fbbc04",
    "#ea4335",
    "#0bc5b8",
    "#ff8a65",
    "#7e57c2",
  ];
  return palette[hash % palette.length];
}
