import { useEffect, useState } from "react";
import {
  ChevronRight,
  Loader2,
  Play,
  Square,
  Workflow,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import {
  advanceWorkflowRun,
  fetchWorkflowRuns,
  fetchWorkflows,
  startWorkflowRun,
  type WorkflowDefinition,
  type WorkflowRun,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function WorkflowEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const reload = async () => {
    if (!currentOrganization || !tab.parentRefId || !tab.refId) return;
    setLoading(true);
    const [defs, rs] = await Promise.all([
      fetchWorkflows({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        systemId: tab.parentRefId,
      }).catch(() => []),
      fetchWorkflowRuns({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        workflowDefinitionId: tab.refId,
      }).catch(() => []),
    ]);
    setWorkflow(defs.find((w) => w.id === tab.refId) ?? null);
    setRuns(rs);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id, tab.parentRefId, tab.refId]);

  const startRun = async () => {
    if (!workflow || !currentOrganization || !currentWorkspace) return;
    setBusy("start");
    try {
      const run = await startWorkflowRun({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        systemId: workflow.systemId,
        workflowDefinitionId: workflow.id,
      });
      setRuns((cur) => [run, ...cur]);
      appendRunLog({
        level: "ok",
        text: `Run started · ${run.id.slice(0, 8)}`,
        source: "workflows",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Start failed: ${(err as Error).message}`,
        source: "workflows",
      });
    } finally {
      setBusy(null);
    }
  };

  const advance = async (
    run: WorkflowRun,
    action: "advance" | "approve" | "reject" | "complete" | "cancel" | "fail",
  ) => {
    setBusy(run.id);
    try {
      const next = await advanceWorkflowRun(run.id, {
        action,
        note: note || undefined,
      });
      setRuns((cur) => cur.map((r) => (r.id === run.id ? next : r)));
      setNote("");
      appendRunLog({
        level: "ok",
        text: `${action} · ${run.id.slice(0, 8)}`,
        source: "workflows",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `${action} failed: ${(err as Error).message}`,
        source: "workflows",
      });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!workflow) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        Workflow not found.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Workflow className="h-4 w-4 text-purple-400" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{workflow.name}</h1>
          <p className="text-[11px] text-app-faint">
            {workflow.triggerType} · {workflow.status}
          </p>
        </div>
        <Button
          onClick={() => void startRun()}
          disabled={busy === "start"}
          size="sm"
          className="ml-auto gap-1"
        >
          {busy === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Start run
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2">
        <section className="flex min-h-0 flex-col border-r border-app">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Definition
          </h2>
          <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] text-emerald-200">
            {JSON.stringify(workflow.definition, null, 2)}
          </pre>
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Runs
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runs.length === 0 ? (
              <p className="px-4 py-4 text-xs text-app-faint">No runs.</p>
            ) : (
              runs.map((r) => (
                <RunCard
                  key={r.id}
                  run={r}
                  busy={busy === r.id}
                  note={note}
                  setNote={setNote}
                  onAction={(a) => void advance(r, a)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function RunCard({
  run,
  busy,
  note,
  setNote,
  onAction,
}: {
  run: WorkflowRun;
  busy: boolean;
  note: string;
  setNote: (v: string) => void;
  onAction: (
    a: "advance" | "approve" | "reject" | "complete" | "cancel" | "fail",
  ) => void;
}) {
  const isOpen = run.status === "active";
  return (
    <div className="border-b border-app px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
            run.status === "completed"
              ? "bg-emerald-500/20 text-emerald-200"
              : run.status === "failed"
              ? "bg-rose-500/20 text-rose-200"
              : run.status === "cancelled"
              ? "bg-slate-700 text-app-muted"
              : "bg-amber-500/20 text-amber-200"
          }`}
        >
          {run.status}
        </span>
        <span className="font-mono text-app-subtle">{run.id.slice(0, 8)}</span>
        {run.currentStepKey && (
          <span className="flex items-center gap-1 text-app-muted">
            <ChevronRight className="h-3 w-3" />
            {run.currentStepKey}
          </span>
        )}
        <span className="ml-auto text-app-faint">
          {new Date(run.createdAt).toLocaleString()}
        </span>
      </div>
      {run.lastError && (
        <p className="mt-1 text-rose-300">{run.lastError}</p>
      )}
      {run.history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-app-faint hover:text-app-muted">
            History · {run.history.length}
          </summary>
          <div className="mt-1 space-y-0.5 text-[11px] text-app-subtle">
            {run.history.slice(-8).map((h, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-app-faint">
                  {new Date(h.at).toLocaleTimeString()}
                </span>
                <span className="font-medium text-app-muted">{h.action}</span>
                <span className="text-app-faint">
                  {h.fromStepKey ?? "?"} → {h.toStepKey ?? "?"}
                </span>
                {h.note && <span className="text-app-subtle">— {h.note}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
      {isOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="h-7 max-w-xs border-app bg-app-surface text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction("advance")}
            className="gap-1"
          >
            <ChevronRight className="h-3 w-3" /> Advance
          </Button>
          <span className="text-xs text-app-faint">
            Ask the coworker to approve, reject, or revise this run.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction("cancel")}
            className="gap-1"
          >
            <Square className="h-3 w-3" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
