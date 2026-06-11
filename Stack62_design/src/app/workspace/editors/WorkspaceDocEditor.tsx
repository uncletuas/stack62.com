import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
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
  MessageSquarePlus,
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
 */
export function WorkspaceDocEditor({ tab }: { tab: EditorTab }) {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, updateTab } = useWorkspace();

  const docId = tab.refId;

  const [docKind, setDocKind] = useState<WorkspaceDocKind | null>(null);
  useEffect(() => {
    if (!docId) return;
    let alive = true;
    void fetchWorkspaceDoc(docId)
      .then((d) => {
        if (alive) setDocKind(d.kind);
      })
      .catch(() => {
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

  const ydoc = useMemo(() => new Y.Doc(), [tab.id, docId]);

  const [providerStatus, setProviderStatus] = useState<
    "connecting" | "connected" | "disconnected" | "authError"
  >("connecting");
  const [peerCount, setPeerCount] = useState(0);
  const [docTitle, setDocTitle] = useState<string>(tab.title ?? "Untitled");
  const [showActivity, setShowActivity] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [newCommentBody, setNewCommentBody] = useState("");

  const addComment = async () => {
    if (!newCommentBody.trim() || !currentOrganization?.id) return;
    try {
      const formData = new FormData();
      formData.append("organizationId", currentOrganization.id);
      formData.append("workspaceId", currentWorkspace?.id ?? "");
      formData.append("action", JSON.stringify({
        verb: "doc.add_comment",
        body: newCommentBody.trim(),
      }));
      const response = await fetch(`/workspace/docs/${docId}/actions`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error("Failed to add comment");
      setNewCommentBody("");
    } catch (err) {
      console.error("Error adding comment:", err);
    }
  };
  const [pageSize, setPageSize] = useState<"letter" | "a4" | "legal">(
    "letter",
  );
  const [aiBadge, setAiBadge] = useState<{ occurredAt: string } | null>(null);
  useEffect(() => {
    if (!aiBadge) return;
    const ms = 15000 - (Date.now() - new Date(aiBadge.occurredAt).getTime());
    if (ms <= 0) {
      setAiBadge(null);
      return;
    }
    const id = window.setTimeout(() => setAiBadge(null), ms);
    return () => window.clearTimeout(id);
  }, [aiBadge]);
  const providerRef = useRef<HocuspocusProvider | null>(null);

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
        setPeerCount(Math.max(0, states.length - 1));
      },
    });
    providerRef.current = provider;

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

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: ydoc, field: "content" }),
        ...(providerRef.current
          ? [
              CollaborationCursor.configure({
                provider: providerRef.current,
                user: {
                  name: user?.firstName
                    ? `${user.firstName} ${user.lastName}`.trim()
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
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
      ],
      editorProps: {
        attributes: {
          class: "workspace-doc-prose prose max-w-none focus:outline-none",
        },
      },
    },
    [ydoc, providerRef.current],
  );

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

  const [comments, setComments] = useState<Array<{ id: string; anchorBlockId?: string; body: string; createdAt: string }>>([]);
  useEffect(() => {
    const commentsMap = ydoc.getMap("comments");
    const refreshComments = () => {
      const arr = Array.from(commentsMap.values()) as Array<{ id: string; anchorBlockId?: string; body: string; createdAt: string }>;
      arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setComments(arr);
    };
    refreshComments();
    commentsMap.observe(refreshComments);
    return () => commentsMap.unobserve(refreshComments);
  }, [ydoc]);

  if (!docId) {
    return (
      <EmptyMessage
        icon={AlertCircle}
        text="No document selected. Ask Coworker to create a workspace doc, or pick one from the workspace tab."
      />
    );
  }

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
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-[#e8eaed] py-8 px-4">
        <PageContainer editor={editor} pageSize={pageSize} />
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
        <Toolbar 
          editor={editor} 
          pageSize={pageSize} 
          setPageSize={setPageSize} 
          showComments={showComments}
          onToggleComments={() => setShowComments(v => !v)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{body}</div>
        {(showActivity || showComments) && (
          <div className="flex flex-col w-80 border-l border-app bg-app-elevated">
            {showActivity && (
              <WorkspaceActivityPanel
                docId={docId}
                open={showActivity}
                onClose={() => setShowActivity(false)}
                onLatestActor={(info) => {
                  if (!info) return;
                  if (info.actorKind !== "coworker") return;
                  const ageMs = Date.now() - new Date(info.occurredAt).getTime();
                  if (ageMs < 15000) {
                    setAiBadge({ occurredAt: info.occurredAt });
                  }
                }}
              />
            )}
            {showComments && (
              <div className="flex flex-col h-full">
                <header className="flex items-center justify-between border-b border-app px-4 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-app-subtle">
                    Comments
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowComments(false)}
                    className="rounded p-1 text-app-muted hover:bg-app-hover"
                  >
                    ×
                  </button>
                </header>
                <div className="flex-1 overflow-auto p-4 space-y-3">
                  {comments.length === 0 ? (
                    <p className="text-sm text-app-faint">No comments yet.</p>
                  ) : (
                    comments.map(comment => (
                      <div key={comment.id} className="rounded border border-app p-3 bg-app">
                        <p className="text-xs text-app-subtle mb-1">
                          {new Date(comment.createdAt).toLocaleString()}
                        </p>
                        <p className="text-sm">{comment.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t border-app p-3">
                  <textarea
                    value={newCommentBody}
                    onChange={e => setNewCommentBody(e.target.value)}
                    placeholder="Add a comment..."
                    className="w-full rounded border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    rows={3}
                    onKeyDown={e => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void addComment();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void addComment()}
                    disabled={!newCommentBody.trim()}
                    className="mt-2 w-full rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    Add Comment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!showActivity && !showComments && (
          <WorkspaceActivityPanel
            docId={docId}
            open={false}
            onClose={() => setShowActivity(false)}
            onLatestActor={(info) => {
              if (!info) return;
              if (info.actorKind !== "coworker") return;
              const ageMs = Date.now() - new Date(info.occurredAt).getTime();
              if (ageMs < 15000) {
                setAiBadge({ occurredAt: info.occurredAt });
              }
            }}
          />
        )}
      </div>
      <style>{`
        .workspace-doc-prose { font-size: 14px; line-height: 1.65; color: #1f1f1f; }
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

function Toolbar({
  editor,
  pageSize,
  setPageSize,
  showComments,
  onToggleComments,
}: {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  pageSize: "letter" | "a4" | "legal";
  setPageSize: (size: "letter" | "a4" | "legal") => void;
  showComments: boolean;
  onToggleComments: () => void;
}) {
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
      <Btn 
        icon={MessageSquarePlus} 
        label="Comments" 
        onClick={onToggleComments} 
        active={showComments} 
      />

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
        onClick={() => editor.chain().focus().toggleUnderline().run()}
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

      <Btn icon={AlignLeft} label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
      <Btn icon={AlignCenter} label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
      <Btn icon={AlignRight} label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />

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

// Page dimensions at 96 dpi
const PAGE_PX = {
  letter: { w: 816, h: 1056 },  // 8.5 × 11 in
  a4:     { w: 794, h: 1123 },  // 8.27 × 11.69 in
  legal:  { w: 816, h: 1344 },  // 8.5 × 14 in
} as const;

const PAGE_MARGIN = 96;  // 1 inch at 96 dpi
const PAGE_GAP    = 24;  // gap between page sheets

function PageContainer({
  editor,
  pageSize,
}: {
  editor: ReturnType<typeof useEditor>;
  pageSize: "letter" | "a4" | "legal";
}) {
  const { w, h } = PAGE_PX[pageSize];
  const usableH   = h - 2 * PAGE_MARGIN;

  const [pages, setPages] = useState(1);

  useEffect(() => {
    if (!editor) return;
    const recalc = () => {
      const raw = editor.view.dom.scrollHeight;
      setPages(Math.max(1, Math.ceil(raw / usableH)));
    };
    recalc();
    editor.on("update", recalc);
    const obs = new ResizeObserver(recalc);
    obs.observe(editor.view.dom);
    return () => {
      editor.off("update", recalc);
      obs.disconnect();
    };
  }, [editor, pageSize, usableH]);

  const totalH = pages * h + (pages - 1) * PAGE_GAP;

  return (
    <div
      className="relative mx-auto"
      style={{ width: w, minHeight: totalH }}
    >
      {/* White page sheets — visual only, behind the editor */}
      {Array.from({ length: pages }).map((_, i) => (
        <div
          key={i}
          style={{
            position:      "absolute",
            top:           i * (h + PAGE_GAP),
            left:          0,
            right:         0,
            height:        h,
            background:    "white",
            boxShadow:     "0 1px 3px rgba(60,64,67,0.15), 0 2px 6px rgba(60,64,67,0.1)",
            pointerEvents: "none",
            zIndex:        0,
          }}
        />
      ))}

      {/* Single editor instance overlaid on all pages */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <EditorContent
          editor={editor}
          className="workspace-doc-prose"
          style={{
            padding:    `${PAGE_MARGIN}px`,
            minHeight:  totalH,
            background: "transparent",
          }}
        />
      </div>
    </div>
  );
}
