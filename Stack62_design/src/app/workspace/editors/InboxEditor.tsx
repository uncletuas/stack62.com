import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Filter,
  Inbox,
  Loader2,
  Plus,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import {
  createTask,
  fetchActivity,
  fetchTasks,
  updateTask,
  type ActivityLog,
  type Task,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

const STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

type TabKey = "mine" | "all" | "activity";

export function InboxEditor() {
  const { user, currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [view, setView] = useState<TabKey>("mine");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", priority: "normal" });

  const reload = async () => {
    if (!currentOrganization) return;
    setLoading(true);
    const [t, a] = await Promise.all([
      fetchTasks({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchActivity({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
    ]);
    setTasks(t);
    setActivity(a);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const myTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.assigneeUserId === user?.id ||
          (!t.assigneeUserId && view === "mine"),
      ),
    [tasks, user?.id, view],
  );
  const allTasks = tasks;

  const setTaskStatus = async (task: Task, status: string) => {
    try {
      const next = await updateTask(task.id, { status });
      setTasks((cur) => cur.map((t) => (t.id === task.id ? next : t)));
      appendRunLog({
        level: "ok",
        text: `${task.title} → ${status}`,
        source: "tasks",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Update failed: ${(err as Error).message}`,
        source: "tasks",
      });
    }
  };

  const submitDraft = async () => {
    if (!currentOrganization || !currentWorkspace || !draft.title.trim()) return;
    setCreating(true);
    try {
      const task = await createTask({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        title: draft.title.trim(),
        priority: draft.priority,
        assigneeUserId: user?.id,
      });
      setTasks((cur) => [task, ...cur]);
      setDraft({ title: "", priority: "normal" });
      appendRunLog({ level: "ok", text: "Task created", source: "tasks" });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Create failed: ${(err as Error).message}`,
        source: "tasks",
      });
    } finally {
      setCreating(false);
    }
  };

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "mine", label: "Mine", count: myTasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length },
    { key: "all", label: "All tasks", count: allTasks.length },
    { key: "activity", label: "Activity", count: activity.length },
  ];

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Inbox className="h-4 w-4 text-indigo-400" />
        <h1 className="text-sm font-semibold">Inbox</h1>
        <div className="ml-4 flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                view === t.key
                  ? "bg-white/10 text-white"
                  : "text-app-subtle hover:bg-white/5"
              }`}
            >
              {t.label}
              <span className="rounded bg-app-elevated px-1.5 text-[10px] text-app-muted">
                {t.count}
              </span>
            </button>
          ))}
        </div>
        {loading && <Loader2 className="ml-auto h-4 w-4 animate-spin text-app-faint" />}
      </header>

      {(view === "mine" || view === "all") && (
        <div className="border-b border-app bg-slate-900/40 px-4 py-2">
          <div className="flex gap-2">
            <Input
              value={draft.title}
              onChange={(e) =>
                setDraft((c) => ({ ...c, title: e.target.value }))
              }
              placeholder="Add a task…"
              className="h-8 border-app bg-app"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitDraft();
              }}
            />
            <select
              value={draft.priority}
              onChange={(e) =>
                setDraft((c) => ({ ...c, priority: e.target.value }))
              }
              className="rounded border border-app bg-app px-2 text-xs"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void submitDraft()}
              disabled={creating || !draft.title.trim()}
              className="gap-1"
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "activity" ? (
          <ActivityList logs={activity} />
        ) : (
          <TaskList
            tasks={view === "mine" ? myTasks : allTasks}
            onStatus={setTaskStatus}
            onUpdate={async (task, patch) => {
              try {
                const next = await updateTask(task.id, patch);
                setTasks((cur) =>
                  cur.map((t) => (t.id === task.id ? next : t)),
                );
              } catch {
                /* ignore */
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  onStatus,
  onUpdate,
}: {
  tasks: Task[];
  onStatus: (t: Task, status: string) => void;
  onUpdate: (
    t: Task,
    patch: Partial<Pick<Task, "status" | "priority" | "dueAt">>,
  ) => Promise<void>;
}) {
  if (tasks.length === 0) {
    return <p className="px-6 py-8 text-sm text-app-faint">Nothing here.</p>;
  }
  return (
    <div className="divide-y divide-app">
      {tasks.map((t) => {
        const done = t.status === "done";
        return (
          <div
            key={t.id}
            className="flex items-center gap-3 px-4 py-2 hover:bg-white/5"
          >
            <button
              onClick={() => onStatus(t, done ? "todo" : "done")}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                done
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : "border-app-strong text-transparent hover:border-slate-500"
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
            </button>
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm ${
                  done ? "text-app-faint line-through" : "text-app"
                }`}
              >
                {t.title}
              </p>
              {t.description && (
                <p className="truncate text-xs text-app-faint">
                  {t.description}
                </p>
              )}
            </div>
            <select
              value={t.priority}
              onChange={(e) => void onUpdate(t, { priority: e.target.value })}
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                t.priority === "urgent"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  : t.priority === "high"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-app-strong bg-app-surface text-app-subtle"
              }`}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={t.status}
              onChange={(e) => void onStatus(t, e.target.value)}
              className="rounded border border-app-strong bg-app-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-app-muted"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {t.dueAt && (
              <span className="flex items-center gap-1 text-[11px] text-app-faint">
                <Clock className="h-3 w-3" />
                {new Date(t.dueAt).toLocaleDateString()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActivityList({ logs }: { logs: ActivityLog[] }) {
  if (logs.length === 0) {
    return <p className="px-6 py-8 text-sm text-app-faint">No activity.</p>;
  }
  return (
    <div className="divide-y divide-app">
      {logs.map((a) => (
        <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-xs">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase ${
              a.origin === "ai"
                ? "bg-indigo-500/15 text-indigo-300"
                : a.origin === "system"
                ? "bg-slate-700 text-app-muted"
                : "bg-emerald-500/15 text-emerald-300"
            }`}
          >
            {a.origin}
          </span>
          <span className="font-medium text-app">{a.action}</span>
          <span className="truncate text-app-faint">
            {a.targetType} {a.targetId.slice(0, 8)}
          </span>
          <span className="ml-auto shrink-0 text-app-faint">
            {new Date(a.createdAt).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
