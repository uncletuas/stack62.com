import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  Layers,
  Loader2,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  applyAiRequest,
  applyAiRequestSelection,
  fetchAiRequest,
  fetchAiRequestDiff,
  fetchAiRequestImpact,
  rejectAiRequest,
  type AiChangeRequestDetail,
  type AiRequestDiff,
  type AiRequestImpact,
  type DiffOp,
  type EntityDiffItem,
  type FieldDiffItem,
  type ModuleDiffItem,
  type PermissionDiffItem,
  type WorkflowDiffItem,
} from "../../lib/resources";
import type { EditorTab } from "../workspace-context";
import { useWorkspace } from "../workspace-context";

const RISK_COLOR: Record<string, string> = {
  low: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  medium: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  high: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const OP_COLOR: Record<DiffOp, string> = {
  add: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  remove: "text-rose-300 bg-rose-500/10 border-rose-500/30",
  modify: "text-amber-300 bg-amber-500/10 border-amber-500/30",
};

const KIND_ICON: Record<string, LucideIcon> = {
  module: Layers,
  entity: Layers,
  field: Pencil,
  workflow: Workflow,
  permission: ShieldCheck,
};

const OP_ICON: Record<DiffOp, LucideIcon> = {
  add: Plus,
  remove: Minus,
  modify: Pencil,
};

type AnyDiffItem =
  | ModuleDiffItem
  | EntityDiffItem
  | FieldDiffItem
  | WorkflowDiffItem
  | PermissionDiffItem;

export function PlanEditor({ tab }: { tab: EditorTab }) {
  const { appendRunLog, navigate } = useWorkspace();
  const [detail, setDetail] = useState<AiChangeRequestDetail | null>(null);
  const [diff, setDiff] = useState<AiRequestDiff | null>(null);
  const [impact, setImpact] = useState<AiRequestImpact | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tab.refId) return;
    let live = true;
    setDetail(null);
    setDiff(null);
    setImpact(null);
    setSelected(new Set());
    setFocusedId(null);

    let pollHandle: number | null = null;
    let attempts = 0;

    const load = async () => {
      try {
        const next = await fetchAiRequest(tab.refId!);
        if (!live) return;
        setDetail(next);
        const [nextDiff, nextImpact] = await Promise.all([
          fetchAiRequestDiff(next.id).catch(() => null),
          fetchAiRequestImpact(next.id).catch(() => null),
        ]);
        if (!live) return;
        if (nextDiff) {
          setDiff(nextDiff);
          setImpact(nextImpact);
          const all = collectAll(nextDiff);
          setSelected(new Set(all.map((item) => item.id)));
          setFocusedId(all[0]?.id ?? null);
          return; // done
        }
        // No diff yet — poll if request is still being processed.
        const inFlight =
          next.status === "queued" ||
          next.status === "running" ||
          next.status === "draft" ||
          next.status === "pending";
        attempts += 1;
        if (inFlight && attempts < 40) {
          pollHandle = window.setTimeout(() => void load(), 2500);
        }
      } catch {
        if (live) setDetail(null);
      }
    };
    void load();
    return () => {
      live = false;
      if (pollHandle !== null) window.clearTimeout(pollHandle);
    };
  }, [tab.refId]);

  const allItems = useMemo(() => (diff ? collectAll(diff) : []), [diff]);
  const focused = useMemo(
    () => allItems.find((item) => item.id === focusedId) ?? null,
    [allItems, focusedId],
  );

  const totalSelected = selected.size;
  const totalItems = allItems.length;
  const decided =
    detail?.status === "applied" ||
    detail?.status === "rejected" ||
    detail?.status === "cancelled";

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allItems.map((i) => i.id)));
  const selectNone = () => setSelected(new Set());
  const selectSafeOnly = () =>
    setSelected(
      new Set(
        allItems
          .filter((i) => i.op !== "remove" && i.riskScore < 20)
          .map((i) => i.id),
      ),
    );

  const apply = async () => {
    if (!detail || decided) return;
    setBusy(true);
    try {
      const isAll = totalSelected === totalItems;
      const result = isAll
        ? await applyAiRequest(detail.id)
        : await applyAiRequestSelection(detail.id, Array.from(selected));
      appendRunLog({
        level: "ok",
        text: `Applied ${totalSelected} of ${totalItems} change(s)`,
        source: "plans",
      });
      const refreshed = await fetchAiRequest(detail.id).catch(() => null);
      if (refreshed) setDetail(refreshed);
      else setDetail({ ...detail, status: "applied" });
      void result;
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Apply failed: ${(err as Error).message}`,
        source: "plans",
      });
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!detail || decided) return;
    setBusy(true);
    try {
      const rejected = await rejectAiRequest(detail.id, "Rejected from canvas");
      setDetail({ ...detail, status: rejected.status });
      appendRunLog({
        level: "ok",
        text: "Plan rejected",
        source: "plans",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Reject failed: ${(err as Error).message}`,
        source: "plans",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    try {
      const rejected = await rejectAiRequest(detail.id, "Deleted by user");
      setDetail({ ...detail, status: rejected.status });
      navigate({ kind: "welcome", title: "Workspace" });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Delete failed: ${(err as Error).message}`,
        source: "plans",
      });
    }
  };

  if (!detail) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const totals = impact?.impact.totals ?? {
    recordsAffected: 0,
    workflowsAffected: 0,
    destructiveChanges: 0,
  };

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <GitBranch className="h-4 w-4 text-amber-400" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {detail.summary ?? "Plan"}
          </h1>
          <p className="text-[11px] text-app-faint">
            {new Date(detail.createdAt).toLocaleString()} · {detail.status}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
            RISK_COLOR[diff?.riskLevel ?? detail.riskLevel ?? "low"] ??
            "border-app-strong text-app-subtle"
          }`}
        >
          {diff?.riskLevel ?? detail.riskLevel ?? "?"} risk
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => void remove()}
            className="rounded border border-rose-900/70 px-2 py-1 text-xs text-rose-200 hover:bg-rose-950/30"
            disabled={busy}
          >
            <Trash2 className="mr-1 inline h-3 w-3" />
            Delete
          </button>
        </div>
      </header>

      <section className="grid grid-cols-3 gap-2 border-b border-app bg-app-hover px-4 py-2 md:grid-cols-6">
        <Stat
          label="Changes"
          value={totalItems}
          tone={totalItems > 0 ? "info" : "neutral"}
        />
        <Stat
          label="Selected"
          value={totalSelected}
          tone={totalSelected === totalItems ? "ok" : "info"}
        />
        <Stat
          label="Destructive"
          value={totals.destructiveChanges}
          tone={totals.destructiveChanges > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Records affected"
          value={totals.recordsAffected}
          tone={totals.recordsAffected > 0 ? "warn" : "neutral"}
        />
        <Stat
          label="Workflows affected"
          value={totals.workflowsAffected}
          tone={totals.workflowsAffected > 0 ? "warn" : "neutral"}
        />
        <Stat
          label="Risk score"
          value={diff?.riskScore ?? 0}
          tone={
            (diff?.riskLevel ?? "low") === "high"
              ? "danger"
              : (diff?.riskLevel ?? "low") === "medium"
              ? "warn"
              : "neutral"
          }
        />
      </section>

      {detail.validations.length > 0 && (
        <section className="border-b border-app bg-amber-500/5 px-4 py-2 text-xs text-amber-100">
          <h2 className="flex items-center gap-2 font-semibold text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" /> Validations
          </h2>
          <ul className="mt-1 space-y-0.5">
            {detail.validations.flatMap((validation) =>
              [
                ...validation.issues.map((text) => ({ kind: "issue", text })),
                ...validation.warnings.map((text) => ({
                  kind: "warning",
                  text,
                })),
              ].map((item, index) => (
                <li key={`${validation.id}-${index}`} className="flex gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                      item.kind === "issue"
                        ? "bg-rose-500/30 text-rose-200"
                        : "bg-amber-500/30 text-amber-200"
                    }`}
                  >
                    {item.kind}
                  </span>
                  <span>{item.text}</span>
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,420px)_1fr]">
        <aside className="min-h-0 overflow-y-auto border-b border-app lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-app bg-app-elevated px-3 py-2 text-[11px] text-app-subtle">
            <span className="mr-auto uppercase tracking-wide">
              Changes ({totalSelected}/{totalItems})
            </span>
            <button
              onClick={selectAll}
              className="rounded px-2 py-0.5 hover:bg-app-hover"
              disabled={decided}
            >
              All
            </button>
            <button
              onClick={selectNone}
              className="rounded px-2 py-0.5 hover:bg-app-hover"
              disabled={decided}
            >
              None
            </button>
            <button
              onClick={selectSafeOnly}
              className="rounded px-2 py-0.5 hover:bg-app-hover"
              disabled={decided}
              title="Select only additive, low-risk changes"
            >
              Safe only
            </button>
          </div>
          {allItems.length === 0 ? (
            <p className="px-3 py-4 text-xs text-app-faint">
              {diff ? "No structural changes proposed." : "Generating diff..."}
            </p>
          ) : (
            <ul className="divide-y divide-app">
              {allItems.map((item) => (
                <ChangeRow
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  focused={focusedId === item.id}
                  impact={impact?.impact.items[item.id]}
                  decided={decided}
                  onToggle={() => toggle(item.id)}
                  onFocus={() => setFocusedId(item.id)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto bg-app">
          {focused ? (
            <DiffDetail
              item={focused}
              impact={impact?.impact.items[focused.id]}
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-app-faint">
              Select a change on the left to inspect before/after.
            </div>
          )}
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-app bg-app-hover px-4 py-2 text-xs">
        <span className="text-app-subtle">
          {decided ? (
            <span>
              Plan {detail.status}. No further actions.
            </span>
          ) : totalSelected === 0 ? (
            <span className="text-amber-300">
              Nothing selected — pick at least one change to apply.
            </span>
          ) : totalSelected === totalItems ? (
            <span>Approving all {totalItems} change(s).</span>
          ) : (
            <span className="text-amber-300">
              Approving {totalSelected} of {totalItems} (partial). Skipped
              changes will be ignored.
            </span>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void reject()}
            className="rounded border border-app-strong px-3 py-1.5 text-app hover:bg-app-hover disabled:opacity-50"
            disabled={decided || busy}
          >
            <XCircle className="mr-1 inline h-3.5 w-3.5" /> Reject
          </button>
          <button
            onClick={() => void apply()}
            className="rounded bg-emerald-500/90 px-3 py-1.5 font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            disabled={decided || busy || totalSelected === 0}
          >
            {busy ? (
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
            )}
            Approve {totalSelected === totalItems ? "all" : `${totalSelected}`}
          </button>
        </div>
      </footer>
    </div>
  );
}

function ChangeRow({
  item,
  selected,
  focused,
  impact,
  decided,
  onToggle,
  onFocus,
}: {
  item: AnyDiffItem;
  selected: boolean;
  focused: boolean;
  impact?: { recordsAffected: number; workflowsAffected: number; notes: string[] };
  decided: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  const KindIcon = KIND_ICON[item.kind] ?? Layers;
  const OpIcon = OP_ICON[item.op];
  const label = labelFor(item);
  const path = pathFor(item);
  const recordsAffected = impact?.recordsAffected ?? 0;
  const workflowsAffected = impact?.workflowsAffected ?? 0;
  const isDestructive =
    item.op === "remove" ||
    (item.op === "modify" && item.riskScore >= 20) ||
    recordsAffected > 0;

  return (
    <li
      className={`group cursor-pointer px-3 py-2 transition ${
        focused ? "bg-white/5" : "hover:bg-white/[0.025]"
      }`}
      onClick={onFocus}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={decided}
          className="mt-0.5 accent-emerald-500"
        />
        <span
          className={`mt-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase ${OP_COLOR[item.op]}`}
        >
          <OpIcon className="h-3 w-3" />
          {item.op}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindIcon className="h-3.5 w-3.5 text-app-faint" />
            <span className="truncate text-xs font-medium text-app">
              {label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-app-faint">{path}</p>
          {(recordsAffected > 0 || workflowsAffected > 0) && (
            <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
              <Database className="h-3 w-3" />
              {recordsAffected > 0 && <span>{recordsAffected} record(s)</span>}
              {recordsAffected > 0 && workflowsAffected > 0 && <span>·</span>}
              {workflowsAffected > 0 && (
                <span>{workflowsAffected} workflow(s)</span>
              )}
            </p>
          )}
        </div>
        {isDestructive && (
          <span className="mt-0.5 text-rose-400" title="Destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </li>
  );
}

function DiffDetail({
  item,
  impact,
}: {
  item: AnyDiffItem;
  impact?: { recordsAffected: number; workflowsAffected: number; notes: string[] };
}) {
  return (
    <div className="space-y-3 p-4 text-xs">
      <header>
        <h2 className="text-sm font-semibold text-app">
          {labelFor(item)}
        </h2>
        <p className="text-[11px] text-app-faint">{pathFor(item)}</p>
      </header>

      {item.reasons.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-app-subtle">
            Why
          </h3>
          <ul className="space-y-0.5 text-app-muted">
            {item.reasons.map((reason, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-app-faint">·</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {impact && impact.notes.length > 0 && (
        <section className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
          <h3 className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-200">
            <Database className="h-3 w-3" /> Downstream impact
          </h3>
          <ul className="space-y-0.5 text-amber-100">
            {impact.notes.map((note, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-amber-400">·</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <DiffPane title="Before" data={"before" in item ? item.before : null} />
        <DiffPane title="After" data={"after" in item ? item.after : null} />
      </section>
    </div>
  );
}

function DiffPane({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded border border-app bg-app-hover">
      <div className="border-b border-app px-2 py-1 text-[10px] uppercase tracking-wide text-app-subtle">
        {title}
      </div>
      <pre className="max-h-72 overflow-auto p-2 text-[11px] text-app-muted">
        {data === null || data === undefined
          ? "—"
          : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "info" | "warn" | "danger" | "neutral";
}) {
  const styles: Record<typeof tone, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    neutral: "border-app bg-app-elevated/50 text-app-subtle",
  };
  return (
    <div className={`rounded border p-2 ${styles[tone]}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-base font-semibold text-app">{value}</p>
    </div>
  );
}

function collectAll(diff: AiRequestDiff): AnyDiffItem[] {
  return [
    ...diff.diff.modules,
    ...diff.diff.entities,
    ...diff.diff.fields,
    ...diff.diff.workflows,
    ...diff.diff.permissions,
  ];
}

function labelFor(item: AnyDiffItem): string {
  switch (item.kind) {
    case "module":
      return item.after?.name ?? item.before?.name ?? item.moduleKey;
    case "entity":
      return item.after?.name ?? item.before?.name ?? item.entityKey;
    case "field": {
      const name = item.after?.name ?? item.before?.name ?? item.fieldKey;
      const ty = item.after?.dataType ?? item.before?.dataType;
      return ty ? `${name} : ${ty}` : name;
    }
    case "workflow":
      return item.after?.name ?? item.before?.name ?? item.key;
    case "permission":
      return item.after?.name ?? item.before?.name ?? item.identity;
  }
}

function pathFor(item: AnyDiffItem): string {
  switch (item.kind) {
    case "module":
      return `module · ${item.moduleKey}`;
    case "entity":
      return `${item.moduleKey} › ${item.entityKey}`;
    case "field":
      return `${item.moduleKey} › ${item.entityKey} › ${item.fieldKey}`;
    case "workflow":
      return `workflow · ${item.key}`;
    case "permission":
      return `policy · ${item.identity}`;
  }
}
