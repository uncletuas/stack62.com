import { useEffect, useState } from "react";
import {
  CheckCircle2,
  GitBranch,
  Inbox,
  Layers,
  ListTodo,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../../context/app-context";
import {
  createAiRequest,
  fetchActivity,
  fetchAiRequests,
  fetchSystems,
  fetchTasks,
  type ActivityLog,
  type AiChangeRequest,
  type SystemSummary,
  type Task,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

export function WelcomeEditor() {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, setActivity } = useWorkspace();
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [plans, setPlans] = useState<AiChangeRequest[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    setLoading(true);
    void Promise.all([
      fetchSystems({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchAiRequests({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchTasks({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        assigneeUserId: user?.id,
      }).catch(() => []),
      fetchActivity({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
    ]).then(([s, p, t, a]) => {
      if (!live) return;
      setSystems(s);
      setPlans(p);
      setTasks(t);
      setActivityLogs(a);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [currentOrganization, currentWorkspace?.id, user?.id]);

  const pendingPlans = plans.filter(
    (p) => p.status === "pending" || p.status === "draft",
  );
  const openTasks = tasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled",
  );

  const showStarter = !loading && systems.length === 0 && pendingPlans.length === 0;

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-5xl p-10">
        <header className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {user?.firstName ?? "Workspace"}
            </h1>
            <p className="mt-1 text-xs text-app-faint">
              {currentOrganization?.name}
              {currentWorkspace ? ` · ${currentWorkspace.name}` : ""}
            </p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-app-faint" />}
        </header>

        {showStarter && <StarterHero />}

        <section className="grid gap-4 md:grid-cols-3">
          <Panel icon={Layers} title="Systems" count={systems.length} onAction={() => setActivity("systems")}>
            {systems.length === 0 ? (
              <Empty />
            ) : (
              systems.slice(0, 6).map((s) => (
                <RowItem
                  key={s.id}
                  icon={Layers}
                  label={s.name}
                  meta={s.status}
                  onClick={() => navigate({ kind: "system", title: s.name, refId: s.id })}
                />
              ))
            )}
          </Panel>

          <Panel
            icon={GitBranch}
            title="Pending plans"
            count={pendingPlans.length}
            onAction={() => setActivity("flow")}
          >
            {pendingPlans.length === 0 ? (
              <Empty />
            ) : (
              pendingPlans.slice(0, 6).map((p) => (
                <RowItem
                  key={p.id}
                  icon={GitBranch}
                  label={p.summary ?? p.prompt ?? "(plan)"}
                  meta={p.status}
                  onClick={() =>
                    navigate({
                      kind: "plan",
                      title: p.summary ?? "Plan",
                      refId: p.id,
                    })
                  }
                />
              ))
            )}
          </Panel>

          <Panel
            icon={Inbox}
            title="My tasks"
            count={openTasks.length}
            onAction={() => setActivity("flow")}
          >
            {openTasks.length === 0 ? (
              <Empty />
            ) : (
              openTasks.slice(0, 6).map((t) => (
                <RowItem
                  key={t.id}
                  icon={CheckCircle2}
                  label={t.title}
                  meta={t.priority}
                  onClick={() => setActivity("flow")}
                />
              ))
            )}
          </Panel>
        </section>

        <section className="mt-6">
          <Panel
            icon={ListTodo}
            title="Recent activity"
            count={activity.length}
            onAction={() => setActivity("flow")}
          >
            {activity.length === 0 ? (
              <Empty />
            ) : (
              activity.slice(0, 8).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${
                      a.origin === "ai"
                        ? "bg-indigo-500/15 text-indigo-300"
                        : a.origin === "system"
                        ? "bg-slate-700 text-app-muted"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {a.origin}
                  </span>
                  <span className="text-app-muted">{a.action}</span>
                  <span className="text-app-faint">{a.targetType}</span>
                  <span className="ml-auto text-app-faint">
                    {new Date(a.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </section>
      </div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  count,
  onAction,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-app bg-app-hover">
      <div className="flex items-center gap-2 border-b border-app px-3 py-2 text-xs font-semibold text-app-muted">
        <Icon className="h-3.5 w-3.5 text-indigo-400" />
        <span className="flex-1">{title}</span>
        <span className="text-[10px] text-app-faint">{count}</span>
        {onAction && (
          <button
            onClick={onAction}
            className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
          >
            ›
          </button>
        )}
      </div>
      <div className="divide-y divide-app">{children}</div>
    </div>
  );
}

function RowItem({
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-app-hover"
    >
      <Icon className="h-3.5 w-3.5 text-app-subtle" />
      <span className="flex-1 truncate">{label}</span>
      {meta && (
        <span className="text-[10px] uppercase tracking-wider text-app-faint">
          {meta}
        </span>
      )}
    </button>
  );
}

function Empty() {
  return <div className="px-3 py-3 text-xs text-app-faint">—</div>;
}

const STARTER_EXAMPLES = [
  "I run a 12-person consulting firm — track clients, projects, invoices.",
  "We're hiring 3 engineers — track candidates from sourced to offer.",
  "Procurement for a small hospital — vendors, POs, approvals.",
  "I sell pottery online — orders, inventory, fulfillment.",
];

function StarterHero() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!currentOrganization || !currentWorkspace) return;
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createAiRequest({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        prompt: `Build me a Stack62 system to operate this. Description: ${text}`,
        autoApply: false,
      });
      navigate({
        kind: "plan",
        title: "Starter system",
        refId: result.request.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start.");
      setSubmitting(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-app bg-app-elevated p-6">
      <div className="mb-3 flex items-center gap-2 text-accent">
        <Sparkles className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Let's set up your first system
        </span>
      </div>
      <h2 className="text-lg font-semibold text-app">
        Describe what you do — Stack62 will draft a system you can review and run.
      </h2>
      <p className="mt-1 text-xs text-app-subtle">
        Plain English is best. The AI proposes modules, fields, workflows; you
        approve before anything lands.
      </p>

      <div className="mt-4 flex gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="What do you do, day to day?"
          rows={3}
          disabled={submitting}
          className="min-h-[90px] flex-1 resize-none rounded border border-app-strong bg-app-surface px-3 py-2 text-sm text-app placeholder:text-app-faint focus:border-cyan-500/50 focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !prompt.trim()}
          className="flex shrink-0 items-center gap-2 self-start rounded bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Draft my system
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {STARTER_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            disabled={submitting}
            className="rounded-full border border-app-strong bg-app-surface px-3 py-1 text-[11px] text-app-muted hover:border-cyan-500/40 hover:text-accent disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </section>
  );
}
