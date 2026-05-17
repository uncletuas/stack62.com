import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  FileText,
  Layers,
  LineChart,
  MessageSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../../context/app-context";
import {
  fetchDashboard,
  fetchDocuments,
  fetchReports,
  fetchSystems,
  fetchTasks,
  type ActivityLog,
  type Report,
  type SystemSummary,
  type Task,
  type WorkspaceDashboard,
  type WorkspaceDocument,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

interface RecentWork {
  documents: WorkspaceDocument[];
  systems: SystemSummary[];
  tasks: Task[];
  reports: Report[];
}

export function WelcomeEditor() {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, setActivity, setSidebarOpen } = useWorkspace();
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | null>(null);
  const [recent, setRecent] = useState<RecentWork | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const q = {
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace.id,
    };
    Promise.all([
      fetchDashboard(q).catch(() => null),
      fetchDocuments(q).catch(() => []),
      fetchSystems(q).catch(() => []),
      fetchTasks(q).catch(() => []),
      fetchReports(q).catch(() => []),
    ]).then(([dash, docs, systems, tasks, reports]) => {
      if (!live) return;
      setDashboard(dash);
      setRecent({ documents: docs, systems, tasks, reports });
      setLoading(false);
    });
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

  const pendingDecisions =
    (dashboard?.pendingAiRequests ?? 0) + (dashboard?.activeWorkflowRuns ?? 0);

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto max-w-4xl px-6 py-10 sm:px-8">
        {/* Greeting */}
        <header className="mb-7">
          <h1 className="text-3xl font-semibold tracking-tight text-app">
            {greeting}, {firstName}.
          </h1>
          {currentOrganization && (
            <p className="mt-1.5 text-base text-app-muted">
              Here's where things stand in{" "}
              <span className="font-medium text-app">{currentOrganization.name}</span>.
            </p>
          )}
        </header>

        {/* Pick up where you left off */}
        {!loading && recent && (
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-app-faint">
                Pick up where you left off
              </h2>
            </div>
            {recent.documents.length === 0 &&
            recent.systems.length === 0 &&
            recent.tasks.length === 0 &&
            recent.reports.length === 0 ? (
              <p className="rounded-xl border border-dashed border-app bg-app-elevated p-6 text-center text-sm text-app-muted">
                Nothing here yet. Ask your coworker to create something.
                <button
                  onClick={openCoworker}
                  className="ml-2 font-medium text-accent hover:underline"
                >
                  Talk to coworker →
                </button>
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ...recent.documents.slice(0, 2).map((d) => ({
                    icon: FileText as LucideIcon,
                    title: d.title,
                    subtitle: `Document · v${d.currentVersion}`,
                    timestamp: d.updatedAt,
                    onClick: () =>
                      navigate({ kind: "document", title: d.title, refId: d.id }),
                  })),
                  ...recent.systems.slice(0, 2).map((s) => ({
                    icon: Layers as LucideIcon,
                    title: s.name,
                    subtitle: `System · ${s.status}`,
                    timestamp: s.updatedAt,
                    onClick: () =>
                      navigate({ kind: "system", title: s.name, refId: s.id }),
                  })),
                  ...recent.tasks.slice(0, 2).map((t) => ({
                    icon: CheckCircle2 as LucideIcon,
                    title: t.title,
                    subtitle: `Task · ${t.status}`,
                    timestamp: t.updatedAt,
                    onClick: () =>
                      navigate({ kind: "task", title: t.title, refId: t.id }),
                  })),
                  ...recent.reports.slice(0, 2).map((r) => ({
                    icon: LineChart as LucideIcon,
                    title: r.title,
                    subtitle: `Report · ${r.sourceType}`,
                    timestamp: r.updatedAt,
                    onClick: () =>
                      navigate({ kind: "report", title: r.title, refId: r.id }),
                  })),
                ]
                  .sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                  })
                  .slice(0, 6)
                  .map((item, i) => (
                    <RecentCard key={`${item.title}-${i}`} {...item} />
                  ))}
              </div>
            )}
          </section>
        )}

        {/* Quick actions */}
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-app-faint">
            Quick actions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickAction
              icon={MessageSquare}
              title="Talk to coworker"
              description="Hand off a task or ask anything."
              onClick={openCoworker}
            />
            {pendingDecisions > 0 && (
              <QuickAction
                icon={Bell}
                title={`${pendingDecisions} waiting on you`}
                description="Review and approve pending actions."
                onClick={openDecisions}
                highlight
              />
            )}
            <QuickAction
              icon={LineChart}
              title="View reports"
              description="See how your operations are tracking."
              onClick={() => { setActivity("reports"); setSidebarOpen(true); }}
            />
          </div>
        </section>

        {/* Recent activity */}
        {dashboard && dashboard.recentActivity.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-app-faint">
              What's been happening
            </h2>
            <div className="divide-y divide-app rounded-xl border border-app bg-app-elevated overflow-hidden">
              {dashboard.recentActivity.slice(0, 6).map((log) => (
                <ActivityRow key={log.id} log={log} />
              ))}
            </div>
          </section>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-app bg-app-elevated" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentCard({
  icon: Icon,
  title,
  subtitle,
  timestamp,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  timestamp?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border border-app bg-app-elevated p-4 text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-app">{title}</p>
        <p className="mt-0.5 text-[11px] text-app-muted">{subtitle}</p>
        {timestamp && (
          <p className="mt-0.5 text-[10px] text-app-faint">{timeAgo(timestamp)}</p>
        )}
      </div>
      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-app-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
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
      className={`group flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        highlight
          ? "border-rose-500/40 bg-rose-500/5 hover:border-rose-500/60"
          : "border-app bg-app-elevated hover:border-accent"
      }`}
    >
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${highlight ? "bg-rose-500/15 text-rose-400" : "bg-accent-soft text-accent"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold text-app">{title}</span>
      <span className="text-xs leading-relaxed text-app-muted">{description}</span>
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

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-app-faint" />
      <span className="min-w-0 flex-1 truncate text-xs text-app-muted">{label}</span>
      <span className="shrink-0 text-[10px] text-app-faint">{timeAgo(log.createdAt)}</span>
      {log.origin === "ai" && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-accent-soft text-accent">
          AI
        </span>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}
