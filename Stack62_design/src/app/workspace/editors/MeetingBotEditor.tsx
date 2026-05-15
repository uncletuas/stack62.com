import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Mic,
  RefreshCcw,
  Send,
  Video,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { useAppContext } from "../../context/app-context";
import {
  fetchMeetingBotSession,
  fetchMeetingBotSessions,
  fetchMeetingBotTranscript,
  scheduleMeetingBot,
  speakInMeeting,
  type MeetingBotSession,
  type MeetingBotStatus,
  type MeetingBotTranscriptLine,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

const STATUS_TONE: Record<MeetingBotStatus, string> = {
  queued: "text-slate-300 bg-slate-800/60",
  joining: "text-amber-200 bg-amber-900/40",
  in_meeting: "text-emerald-300 bg-emerald-900/40",
  summarising: "text-sky-300 bg-sky-900/40",
  completed: "text-app-muted bg-app-hover",
  failed: "text-rose-300 bg-rose-950/60",
  cancelled: "text-app-faint bg-app-hover",
};

export function MeetingBotEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, navigate } = useWorkspace();
  const [sessions, setSessions] = useState<MeetingBotSession[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(tab.refId ?? null);
  const [detail, setDetail] = useState<MeetingBotSession | null>(null);
  const [transcript, setTranscript] = useState<MeetingBotTranscriptLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleUrl, setScheduleUrl] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [speakText, setSpeakText] = useState("");
  const [speaking, setSpeakingBusy] = useState(false);

  const orgId = currentOrganization?.id;
  const workspaceId = currentWorkspace?.id;

  const loadList = useCallback(async () => {
    if (!orgId) return;
    setListLoading(true);
    try {
      const rows = await fetchMeetingBotSessions({ organizationId: orgId });
      setSessions(rows);
      if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Meeting bot list failed: ${(err as Error).message}`,
        source: "meeting-bot",
      });
    } finally {
      setListLoading(false);
    }
  }, [orgId, selectedId, appendRunLog]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const [s, t] = await Promise.all([
          fetchMeetingBotSession(id),
          fetchMeetingBotTranscript(id).catch(() => []),
        ]);
        setDetail(s);
        setTranscript(t);
      } catch (err) {
        appendRunLog({
          level: "error",
          text: `Meeting bot detail failed: ${(err as Error).message}`,
          source: "meeting-bot",
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [appendRunLog],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setTranscript([]);
    }
  }, [selectedId, loadDetail]);

  // Poll while the selected session is live so the user sees progress.
  useEffect(() => {
    if (!detail) return;
    const live =
      detail.status === "queued" ||
      detail.status === "joining" ||
      detail.status === "in_meeting" ||
      detail.status === "summarising";
    if (!live) return;
    const t = window.setInterval(() => {
      void loadDetail(detail.id);
      void loadList();
    }, 5000);
    return () => window.clearInterval(t);
  }, [detail, loadDetail, loadList]);

  const canSpeak = detail?.status === "in_meeting";

  const submitSchedule = async () => {
    if (!orgId || !workspaceId || !scheduleUrl.trim()) return;
    setScheduling(true);
    try {
      const session = await scheduleMeetingBot({
        organizationId: orgId,
        workspaceId,
        meetingUrl: scheduleUrl.trim(),
        title: scheduleTitle.trim() || undefined,
      });
      setScheduleUrl("");
      setScheduleTitle("");
      setSelectedId(session.id);
      await loadList();
      appendRunLog({
        level: "ok",
        text: `Bot scheduled for ${session.meetingUrl}`,
        source: "meeting-bot",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Schedule failed: ${(err as Error).message}`,
        source: "meeting-bot",
      });
    } finally {
      setScheduling(false);
    }
  };

  const submitSpeak = async () => {
    if (!detail || !speakText.trim()) return;
    setSpeakingBusy(true);
    try {
      await speakInMeeting(detail.id, speakText.trim());
      appendRunLog({
        level: "ok",
        text: `Queued: "${speakText.slice(0, 60)}${speakText.length > 60 ? "…" : ""}"`,
        source: "meeting-bot",
      });
      setSpeakText("");
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Speak failed: ${(err as Error).message}`,
        source: "meeting-bot",
      });
    } finally {
      setSpeakingBusy(false);
    }
  };

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [sessions],
  );

  return (
    <div className="flex h-full bg-app text-app">
      {/* Sessions list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-app">
        <header className="flex items-center gap-2 border-b border-app px-3 py-2">
          <Video className="h-4 w-4 text-emerald-300" />
          <h2 className="text-sm font-semibold">Meeting bot</h2>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 w-6 p-0"
            onClick={() => void loadList()}
            title="Refresh"
          >
            {listLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
          </Button>
        </header>
        <div className="border-b border-app p-3">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-app-faint">
            Schedule a new meeting
          </label>
          <Input
            value={scheduleUrl}
            onChange={(e) => setScheduleUrl(e.target.value)}
            placeholder="https://meet.google.com/abc-defg-hij"
            className="mt-1 h-8 border-app bg-app-surface text-xs"
          />
          <Input
            value={scheduleTitle}
            onChange={(e) => setScheduleTitle(e.target.value)}
            placeholder="Title (optional)"
            className="mt-1 h-8 border-app bg-app-surface text-xs"
          />
          <Button
            size="sm"
            className="mt-2 h-7 w-full text-xs"
            onClick={() => void submitSchedule()}
            disabled={scheduling || !scheduleUrl.trim() || !workspaceId}
          >
            {scheduling ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Send bot
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {sortedSessions.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-app-faint">
              {listLoading ? "Loading…" : "No sessions yet."}
            </li>
          ) : (
            sortedSessions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setSelectedId(s.id);
                    navigate({
                      kind: "meeting-bot",
                      title: s.title || "Meeting",
                      refId: s.id,
                    });
                  }}
                  className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-xs hover:bg-app-hover ${
                    selectedId === s.id ? "bg-app-hover" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">
                      {s.title || prettyHost(s.meetingUrl)}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[s.status]}`}
                    >
                      {s.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="truncate text-app-faint">
                    {formatRelative(s.createdAt)}
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Detail */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!detail ? (
          <div className="grid flex-1 place-items-center text-sm text-app-faint">
            {detailLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <span>Select a session to see transcript + speak.</span>
            )}
          </div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-app px-5 py-3">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold">
                  {detail.title || prettyHost(detail.meetingUrl)}
                </h1>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-app-faint">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[detail.status]}`}
                  >
                    {detail.status.replace("_", " ")}
                  </span>
                  <a
                    href={detail.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-app-muted"
                  >
                    Meet link <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {detail.errorMessage && (
                  <p className="mt-1 text-xs text-rose-300">
                    {detail.errorMessage}
                  </p>
                )}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {detail.summary && (
                <section className="mb-4 rounded-md border border-app bg-app-surface px-4 py-3">
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-app-subtle">
                    Summary
                  </h2>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-app-muted">
                    {detail.summary}
                  </p>
                </section>
              )}
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-subtle">
                  Transcript ({transcript.length})
                </h2>
                {transcript.length === 0 ? (
                  <p className="text-xs text-app-faint">
                    No captions captured yet.
                  </p>
                ) : (
                  <ol className="space-y-1.5 text-sm leading-relaxed">
                    {transcript.map((line) => (
                      <li key={line.id} className="flex gap-2">
                        {line.speakerLabel && (
                          <span className="shrink-0 text-app-subtle">
                            {line.speakerLabel}:
                          </span>
                        )}
                        <span className="text-app-muted">{line.text}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            {/* Speak composer — only visible while live. */}
            <footer className="border-t border-app px-5 py-3">
              {canSpeak ? (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
                      Speak into the meeting
                    </label>
                    <Textarea
                      value={speakText}
                      onChange={(e) => setSpeakText(e.target.value)}
                      placeholder="What should the bot say?"
                      maxLength={800}
                      className="min-h-16 border-app bg-app-surface text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void submitSpeak()}
                    disabled={speaking || !speakText.trim()}
                    className="gap-1"
                  >
                    {speaking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Speak
                  </Button>
                </div>
              ) : (
                <p className="flex items-center gap-1 text-xs text-app-faint">
                  <Mic className="h-3 w-3" /> Speak is available while the bot
                  is in the meeting.
                </p>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleDateString();
}
