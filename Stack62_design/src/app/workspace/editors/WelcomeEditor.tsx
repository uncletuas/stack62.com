import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Files as FilesIcon,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../../context/app-context";
import {
  fetchDashboard,
  type ActivityLog,
  type WorkspaceDashboard,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

export function WelcomeEditor() {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, setActivity, setSidebarOpen } = useWorkspace();
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    fetchDashboard({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace.id,
    })
      .then((data) => { if (live) { setDashboard(data); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const firstName = user?.firstName?.trim() || user?.email?.split("@")[0] || "there";
  const greeting = timeGreeting();

  const openCoworker = () =>
    window.dispatchEvent(new CustomEvent("stack62:open-coworker"));

  const openDecisions = () => {
    setActivity("decisions");
    setSidebarOpen(true);
  };

  const openStreamingDoc = () =>
    navigate({ kind: "streaming-doc", title: "Generate document" });

  const openFiles = () => {
    setActivity("files");
    setSidebarOpen(false);
    navigate({ kind: "files-explorer", title: "Files" });
  };

  const pendingDecisions =
    (dashboard?.pendingAiRequests ?? 0) + (dashboard?.activeWorkflowRuns ?? 0);

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-8 sm:py-16">
        {/* Greeting */}
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-app">
            {greeting}, {firstName}.
          </h1>
          {currentOrganization && (
            <p className="mt-1.5 text-base text-app-muted">
              Here's what's happening in{" "}
              <span className="font-medium text-app">{currentOrganization.name}</span>.
            </p>
          )}
        </header>

        {/* Live stats row */}
        {!loading && dashboard && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Pending decisions"
              value={pendingDecisions}
              accent={pendingDecisions > 0}
              onClick={openDecisions}
            />
            <StatTile
              label="Handled by coworker today"
              value={dashboard.aiHandledToday}
            />
            <StatTile
              label="Active runs"
              value={dashboard.activeWorkflowRuns}
            />
            <StatTile
              label="AI requests queued"
              value={dashboard.pendingAiRequests}
            />
          </div>
        )}
        {loading && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-app bg-app-elevated p-4">
                <div className="mb-2 h-7 w-12 rounded bg-app-faint/30" />
                <div className="h-3 w-24 rounded bg-app-faint/20" />
              </div>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            icon={MessageSquare}
            title="Talk to Coworker"
            description="Hand off a task or ask anything."
            onClick={openCoworker}
          />
          {pendingDecisions > 0 ? (
            <QuickAction
              icon={Bell}
              title={`${pendingDecisions} decision${pendingDecisions !== 1 ? "s" : ""} waiting`}
              description="Review and approve pending AI actions."
              onClick={openDecisions}
              highlight
            />
          ) : (
            <QuickAction
              icon={Zap}
              title="View operations"
              description="See your running systems and workflows."
              onClick={() => { setActivity("systems"); setSidebarOpen(true); }}
            />
          )}
          <QuickAction
            icon={Sparkles}
            title="Generate document"
            description="Watch your coworker write it live."
            onClick={openStreamingDoc}
          />
          <QuickAction
            icon={FilesIcon}
            title="Browse files"
            description="Open the workspace library."
            onClick={openFiles}
          />
        </div>

        {/* Recent activity */}
        {dashboard && dashboard.recentActivity.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-app-faint">
              Recent activity
            </h2>
            <div className="divide-y divide-app rounded-xl border border-app bg-app-elevated overflow-hidden">
              {dashboard.recentActivity.slice(0, 8).map((log) => (
                <ActivityRow key={log.id} log={log} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: number;
  accent?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        accent
          ? "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer"
          : onClick
            ? "border-app bg-app-elevated hover:bg-app-hover cursor-pointer"
            : "border-app bg-app-elevated"
      }`}
    >
      <p className={`text-2xl font-bold tabular-nums ${accent ? "text-rose-400" : "text-app"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-app-muted leading-snug">{label}</p>
    </Tag>
  );
}

function QuickAction({
  icon: Icon,
  title,
  description,
  onClick,
  highlight,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-start gap-2.5 rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        highlight
          ? "border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60"
          : "border-app bg-app-elevated hover:border-accent"
      }`}
    >
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${highlight ? "bg-rose-500/15 text-rose-400" : "bg-accent-soft text-accent"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold text-app">{title}</span>
      <span className="flex-1 text-xs leading-relaxed text-app-muted">
        {description}
      </span>
      <span className="flex items-center gap-1 text-[11px] font-medium text-app-faint group-hover:text-accent transition">
        Open
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function ActivityRow({ log }: { log: ActivityLog }) {
  const label = (() => {
    const title =
      typeof log.metadata?.title === "string"
        ? log.metadata.title
        : typeof log.metadata?.toolName === "string"
          ? log.metadata.toolName
          : log.targetType;
    return `${log.action.replace(/\./g, " ")} · ${title}`;
  })();

  const timeAgo = (() => {
    const diff = Date.now() - new Date(log.createdAt).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  })();

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-app-faint" />
      <span className="min-w-0 flex-1 truncate text-xs text-app-muted">{label}</span>
      <span className="shrink-0 text-[10px] text-app-faint">{timeAgo}</span>
      {log.origin === "ai" && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-accent-soft text-accent">
          AI
        </span>
      )}
    </div>
  );
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}
