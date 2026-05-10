import { useEffect, useState } from "react";
import {
  Bot,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  Save,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { DraftPreview } from "./DraftPreview";
import {
  cancelJob,
  fetchCoworkerJob,
  fetchJobRuns,
  pauseJob,
  resumeJob,
  runJob,
  updateJob,
  type CoworkerJob,
  type CoworkerJobRun,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function JobEditor({ tab }: { tab: EditorTab }) {
  const { appendRunLog, updateTab } = useWorkspace();
  const [job, setJob] = useState<CoworkerJob | null>(null);
  const [runs, setRuns] = useState<CoworkerJobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    instructions: "",
    rrule: "",
    runAt: "",
    autopilot: true,
    triggerType: "manual" as "manual" | "schedule" | "event",
  });

  const reload = async () => {
    const jobId = tab.refId;
    if (!jobId) return;
    setLoading(true);
    const [j, r] = await Promise.all([
      fetchCoworkerJob(jobId).catch(() => null),
      fetchJobRuns(jobId).catch(() => []),
    ]);
    if (j) {
      setJob(j);
      setDraft({
        title: j.title,
        instructions: j.instructions,
        rrule: j.triggerConfig?.rrule ?? "",
        runAt: j.triggerConfig?.runAt
          ? new Date(j.triggerConfig.runAt).toISOString().slice(0, 16)
          : "",
        autopilot: j.autopilot,
        triggerType: j.triggerType,
      });
    }
    setRuns(r);
    setLoading(false);
  };

  useEffect(() => {
    if (!tab.refId) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.refId]);

  if (!tab.refId) {
    return <DraftPreview icon={Bot} title="Ask the coworker to set up this job" />;
  }

  const save = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const updated = await updateJob(job.id, {
        title: draft.title,
        instructions: draft.instructions,
        triggerType: draft.triggerType,
        triggerConfig: {
          rrule: draft.rrule || null,
          runAt: draft.runAt ? new Date(draft.runAt).toISOString() : null,
        },
        autopilot: draft.autopilot,
      });
      setJob(updated);
      updateTab(tab.id, { title: updated.title, dirty: false });
      appendRunLog({
        level: "ok",
        text: `Job "${updated.title}" saved`,
        source: "coworker",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "coworker",
      });
    } finally {
      setBusy(false);
    }
  };

  const action = async (act: "run" | "pause" | "resume" | "cancel") => {
    if (!job) return;
    setBusy(true);
    try {
      if (act === "run") {
        await runJob(job.id);
        appendRunLog({
          level: "ok",
          text: `Triggered "${job.title}" — running now`,
          source: "coworker",
        });
      } else if (act === "pause") await pauseJob(job.id);
      else if (act === "resume") await resumeJob(job.id);
      else if (act === "cancel") await cancelJob(job.id);
      await reload();
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `${act} failed: ${(err as Error).message}`,
        source: "coworker",
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
  if (!job) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        Job not found.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Bot className="h-4 w-4 text-indigo-400" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{job.title}</h1>
          <p className="text-[11px] text-app-faint">
            {job.triggerType} ·{" "}
            <span
              className={
                job.status === "failed"
                  ? "text-rose-300"
                  : job.status === "completed"
                  ? "text-emerald-300"
                  : "text-app-subtle"
              }
            >
              {job.status}
            </span>
            {job.runCount > 0 && ` · ${job.runCount} runs`}
            {job.nextRunAt &&
              ` · next ${new Date(job.nextRunAt).toLocaleString()}`}
          </p>
        </div>
        <div className="ml-auto flex gap-1">
          <Button
            onClick={() => void action("run")}
            disabled={busy || job.status === "cancelled"}
            size="sm"
            className="gap-1"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run now
          </Button>
          {job.status === "paused" ? (
            <Button
              onClick={() => void action("resume")}
              disabled={busy}
              size="sm"
              variant="outline"
              className="gap-1"
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          ) : (
            <Button
              onClick={() => void action("pause")}
              disabled={busy || job.status === "cancelled"}
              size="sm"
              variant="outline"
              className="gap-1"
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          <Button
            onClick={() => void action("cancel")}
            disabled={busy || job.status === "cancelled"}
            size="sm"
            variant="outline"
            className="gap-1"
          >
            <Trash2 className="h-3.5 w-3.5" /> Cancel
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
        <section className="flex min-h-0 flex-col border-r border-app">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Configuration
          </h2>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <Field label="Title">
              <Input
                value={draft.title}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                className="border-app bg-app-surface"
              />
            </Field>
            <Field label="Instructions">
              <Textarea
                value={draft.instructions}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, instructions: e.target.value }))
                }
                className="min-h-[160px] border-app bg-app-surface text-white"
              />
            </Field>
            <Field label="Trigger">
              <select
                value={draft.triggerType}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    triggerType: e.target.value as
                      | "manual"
                      | "schedule"
                      | "event",
                  }))
                }
                className="w-full rounded border border-app bg-app-surface p-2 text-sm"
              >
                <option value="manual">Manual — only when triggered</option>
                <option value="schedule">Schedule — runs by itself</option>
              </select>
            </Field>
            {draft.triggerType === "schedule" && (
              <>
                <Field label="One-shot run-at (optional)">
                  <Input
                    type="datetime-local"
                    value={draft.runAt}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, runAt: e.target.value }))
                    }
                    className="border-app bg-app-surface"
                  />
                </Field>
                <Field label="Recurring (RRULE)">
                  <Input
                    value={draft.rrule}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, rrule: e.target.value }))
                    }
                    placeholder="e.g. FREQ=WEEKLY;BYDAY=MO"
                    className="border-app bg-app-surface font-mono"
                  />
                </Field>
              </>
            )}
            <label className="flex items-center gap-2 text-xs text-app-muted">
              <input
                type="checkbox"
                checked={draft.autopilot}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, autopilot: e.target.checked }))
                }
              />
              Autopilot — coworker acts without asking each run
            </label>
            <Button
              onClick={() => void save()}
              disabled={busy}
              size="sm"
              className="gap-1"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Runs
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {runs.length === 0 ? (
              <p className="px-4 py-4 text-xs text-app-faint">No runs yet.</p>
            ) : (
              runs.map((r) => <RunCard key={r.id} run={r} />)
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function RunCard({ run }: { run: CoworkerJobRun }) {
  const [open, setOpen] = useState(false);
  const stepCount = (run.steps as Array<{ type: string }> | undefined)?.length ?? 0;
  return (
    <div className="border-b border-app px-4 py-2 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-app-faint" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-app-faint" />
        )}
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
            run.status === "succeeded"
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
        <Calendar className="h-3 w-3 shrink-0 text-app-faint" />
        <span className="text-app-muted">
          {run.startedAt
            ? new Date(run.startedAt).toLocaleString()
            : new Date(run.createdAt).toLocaleString()}
        </span>
        <span className="ml-auto text-app-faint">{run.triggeredBy}</span>
        <span className="text-app-faint">{stepCount} steps</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {run.errorMessage && (
            <p className="rounded bg-rose-500/10 px-2 py-1 text-rose-200">
              {run.errorMessage}
            </p>
          )}
          {run.summary && (
            <p className="rounded bg-slate-900/60 px-2 py-1 text-app whitespace-pre-wrap">
              {run.summary}
            </p>
          )}
          {(run.steps as Array<{
            type: string;
            name?: string;
            text?: string;
            ok?: boolean;
          }>)?.map((s, i) => (
            <StepLine key={i} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepLine({
  step,
}: {
  step: { type: string; name?: string; text?: string; ok?: boolean };
}) {
  if (step.type === "tool_call") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-app-subtle">
        <Wrench className="h-3 w-3 text-amber-400" />
        <span className="font-mono">{step.name}</span>
      </div>
    );
  }
  if (step.type === "tool_result") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-app-subtle">
        {step.ok ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <X className="h-3 w-3 text-rose-400" />
        )}
        <span className="font-mono">{step.name}</span>
        {step.text && <span className="truncate">{step.text}</span>}
      </div>
    );
  }
  if (step.type === "message" && step.text) {
    return (
      <p className="rounded bg-slate-900/40 px-2 py-1 text-[11px] text-app whitespace-pre-wrap">
        {step.text}
      </p>
    );
  }
  return null;
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
