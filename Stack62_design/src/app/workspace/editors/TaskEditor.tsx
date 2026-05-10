import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { useAppContext } from "../../context/app-context";
import {
  fetchTasks,
  updateTask,
  type Task,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { DraftPreview } from "./DraftPreview";

const STATUSES = ["todo", "pending", "in_progress", "blocked", "done", "completed"];
const PRIORITIES = ["low", "normal", "medium", "high", "urgent"];

const localDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function TaskEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, updateTab } = useWorkspace();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    status: "todo",
    priority: "normal",
    dueAt: "",
    assigneeUserId: "",
    metadata: "{}",
  });

  useEffect(() => {
    if (!tab.refId || !currentOrganization) {
      setLoading(false);
      setTask(null);
      return;
    }
    let live = true;
    setLoading(true);
    void fetchTasks({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => {
        const found = rows.find((row) => row.id === tab.refId) ?? null;
        if (!live) return;
        setTask(found);
        if (found) {
          setDraft({
            status: found.status,
            priority: found.priority,
            dueAt: localDate(found.dueAt),
            assigneeUserId: found.assigneeUserId ?? "",
            metadata: JSON.stringify(found.metadata ?? {}, null, 2),
          });
        }
      })
      .catch(() => live && setTask(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [tab.refId, currentOrganization, currentWorkspace?.id]);

  if (!tab.refId) {
    return <DraftPreview icon={CheckCircle2} title="Ask the coworker to create this task" />;
  }

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft((cur) => ({ ...cur, [key]: value }));
    updateTab(tab.id, { dirty: true });
  };

  const save = async () => {
    if (!task) return;
    setBusy(true);
    try {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = draft.metadata ? JSON.parse(draft.metadata) : {};
      } catch {
        appendRunLog({
          level: "warn",
          text: "Invalid metadata JSON saved as an empty object",
          source: "task",
        });
      }
      const next = await updateTask(task.id, {
        status: draft.status,
        priority: draft.priority,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        assigneeUserId: draft.assigneeUserId || null,
        metadata,
      });
      setTask(next);
      updateTab(tab.id, { title: next.title, dirty: false });
      appendRunLog({
        level: "ok",
        text: `Task "${next.title}" updated`,
        source: "task",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "task",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        Task not found.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-4xl p-6">
        <header className="flex items-center gap-3 border-b border-app pb-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{task.title}</h1>
            <p className="text-xs text-app-faint">
              {task.status} · {task.priority}
              {task.dueAt && ` · due ${new Date(task.dueAt).toLocaleString()}`}
            </p>
          </div>
          <Button
            onClick={() => void save()}
            disabled={busy}
            size="sm"
            className="ml-auto gap-1"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </header>

        {task.description && (
          <section className="mt-4 rounded-lg border border-app bg-slate-900/35 p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-faint">
              Description
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-app">
              {task.description}
            </p>
          </section>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full rounded border border-app bg-app-surface p-2 text-sm"
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={draft.priority}
              onChange={(e) => set("priority", e.target.value)}
              className="w-full rounded border border-app bg-app-surface p-2 text-sm"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <Input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(e) => set("dueAt", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Assignee user ID">
            <Input
              value={draft.assigneeUserId}
              onChange={(e) => set("assigneeUserId", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Metadata (JSON)">
            <Textarea
              value={draft.metadata}
              onChange={(e) => set("metadata", e.target.value)}
              className="min-h-32 border-app bg-app-surface font-mono text-xs text-emerald-200"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-app-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
