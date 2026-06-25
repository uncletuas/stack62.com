import { useEffect, useState } from "react";
import { Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../context/app-context";
import {
  fetchEmailConversationMessages,
  fetchEmailConversations,
  sendEmailReply,
  updateEmailConversation,
  type EmailConversation,
  type EmailMessage,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

/**
 * Incoming-email inbox. Shows threads from the org's connected mailbox(es),
 * the message history per thread, and a reply box. Coworker-drafted replies
 * appear pre-filled in the reply box for the user to approve, edit, or send.
 */
export function EmailInboxEditor() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [conversations, setConversations] = useState<EmailConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const reload = async () => {
    if (!currentOrganization) return;
    setLoading(true);
    const rows = await fetchEmailConversations({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    }).catch(() => [] as EmailConversation[]);
    setConversations(rows);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  useEffect(() => {
    const onConnected = () => void reload();
    window.addEventListener("stack62:email-connected", onConnected);
    return () =>
      window.removeEventListener("stack62:email-connected", onConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const openThread = async (conversation: EmailConversation) => {
    setActiveId(conversation.id);
    setLoadingThread(true);
    setReply("");
    try {
      const data = await fetchEmailConversationMessages(conversation.id);
      setMessages(data.messages);
      // Pre-fill the reply box with the latest coworker draft, if any.
      const draft = [...data.messages]
        .reverse()
        .find((m) => m.status === "draft");
      if (draft) setReply(draft.bodyText);
      if (conversation.unreadCount > 0) {
        await updateEmailConversation(conversation.id, { markRead: true });
        setConversations((cur) =>
          cur.map((c) =>
            c.id === conversation.id ? { ...c, unreadCount: 0 } : c,
          ),
        );
      }
    } catch (err) {
      appendRunLog({
        level: "warn",
        text: `Could not open email thread: ${(err as Error).message}`,
        source: "email",
      });
    } finally {
      setLoadingThread(false);
    }
  };

  const send = async () => {
    if (!activeId || !reply.trim()) return;
    setSending(true);
    try {
      await sendEmailReply(activeId, { bodyText: reply.trim() });
      appendRunLog({ level: "ok", text: "Reply sent.", source: "email" });
      setReply("");
      const data = await fetchEmailConversationMessages(activeId);
      setMessages(data.messages);
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Send failed: ${(err as Error).message}`,
        source: "email",
      });
    } finally {
      setSending(false);
    }
  };

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const hasDraft = messages.some((m) => m.status === "draft");

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-app">
        <header className="flex items-center gap-2 border-b border-app px-3 py-2.5">
          <Mail className="h-4 w-4 text-app-muted" />
          <h2 className="text-sm font-semibold text-app">Email</h2>
          <button
            onClick={() => void reload()}
            className="ml-auto rounded p-1 text-app-muted hover:bg-app-hover hover:text-app"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="grid h-32 place-items-center text-app-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-app-faint">
                No email yet. Connect your mailbox and new mail will appear here.
              </p>
              <Button
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("stack62:open-email-connect"),
                  )
                }
              >
                <Mail className="h-3.5 w-3.5" />
                Connect email
              </Button>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => void openThread(c)}
                className={`block w-full border-b border-app px-3 py-2.5 text-left hover:bg-app-hover ${
                  activeId === c.id ? "bg-app-hover" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`truncate text-xs ${
                      c.unreadCount > 0
                        ? "font-semibold text-app"
                        : "text-app-muted"
                    }`}
                  >
                    {c.counterpartyName || c.counterpartyEmail}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="ml-auto rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-app">
                  {c.subject || "(no subject)"}
                </p>
                <p className="truncate text-[11px] text-app-faint">
                  {c.lastMessagePreview}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Thread view */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="grid flex-1 place-items-center text-sm text-app-faint">
            Select a conversation
          </div>
        ) : (
          <>
            <header className="border-b border-app px-4 py-3">
              <h3 className="text-sm font-semibold text-app">
                {active.subject || "(no subject)"}
              </h3>
              <p className="text-xs text-app-faint">
                {active.counterpartyName
                  ? `${active.counterpartyName} <${active.counterpartyEmail}>`
                  : active.counterpartyEmail}
              </p>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {loadingThread ? (
                <div className="grid h-32 place-items-center text-app-faint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (
                messages
                  .filter((m) => m.status !== "draft")
                  .map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-3 text-sm ${
                        m.direction === "inbound"
                          ? "border-app bg-app-surface"
                          : "border-accent/30 bg-accent-soft/40"
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-app-faint">
                        <span className="font-medium text-app-muted">
                          {m.direction === "inbound"
                            ? active.counterpartyEmail
                            : m.authoredBy === "coworker"
                              ? "Coworker"
                              : "You"}
                        </span>
                        <span>
                          {new Date(m.receivedAt ?? m.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-app">{m.bodyText}</p>
                    </div>
                  ))
              )}
            </div>
            <footer className="border-t border-app p-3">
              {hasDraft && (
                <p className="mb-1.5 text-[11px] font-medium text-accent">
                  Coworker drafted a reply — review and send, or edit first.
                </p>
              )}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={4}
                placeholder={`Reply to ${active.counterpartyEmail}…`}
                className="w-full resize-y rounded-md border border-app bg-app px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  disabled={!reply.trim() || sending}
                  onClick={() => void send()}
                  className="gap-1.5"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send reply
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
