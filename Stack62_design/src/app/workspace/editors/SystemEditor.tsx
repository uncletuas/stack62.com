import { useEffect, useState } from "react";
import {
  Activity,
  Database,
  History,
  Layers,
  Loader2,
  Rocket,
  Share2,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  deleteSystem,
  fetchSystem,
  type SystemDetail,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { DraftPreview } from "./DraftPreview";

export function SystemEditor({ tab }: { tab: EditorTab }) {
  const { appendRunLog, navigate } = useWorkspace();
  const [detail, setDetail] = useState<SystemDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tab.refId) return setDetail(null);
    let live = true;
    setLoading(true);
    fetchSystem(tab.refId)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [tab.refId]);

  if (!tab.refId) {
    return <DraftPreview icon={Sparkles} title="Ask the coworker to build this system" />;
  }

  if (loading || !detail) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const openSubTab = (
    kind: "preview" | "history" | "share",
    suffix: string,
  ) =>
    navigate({
      kind,
      title: `${detail.name} · ${suffix}`,
      refId: detail.id,
    });

  const removeSystem = async () => {
    if (!detail) return;
    try {
      await deleteSystem(detail.id);
      appendRunLog({ level: "ok", text: `Deleted ${detail.name}`, source: "systems" });
      navigate({ kind: "welcome", title: "Workspace" });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Delete failed: ${(err as Error).message}`,
        source: "systems",
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-6xl p-6">
        <header className="border-b border-app pb-4">
          <div className="flex items-center gap-3">
            <Layers className="h-6 w-6 text-indigo-400" />
            <h1 className="text-xl font-semibold">{detail.name}</h1>
            <span className="rounded-full border border-app-strong px-2 py-0.5 text-[10px] uppercase tracking-wide text-app-subtle">
              {detail.status}
            </span>
            <span className="ml-2 text-xs text-app-faint">
              {detail.governanceMode} · {detail.visibility}
            </span>
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openSubTab("preview", "Preview")}
                className="gap-1"
              >
                <Rocket className="h-3.5 w-3.5" /> Preview
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openSubTab("history", "History")}
                className="gap-1"
              >
                <History className="h-3.5 w-3.5" /> History
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openSubTab("share", "Share")}
                className="gap-1"
              >
                <Share2 className="h-3.5 w-3.5" /> Share
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void removeSystem()}
                className="gap-1 border-rose-900/70 text-rose-200 hover:bg-rose-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
          {detail.purpose && (
            <p className="mt-1 text-sm text-app-subtle">{detail.purpose}</p>
          )}
        </header>

        <section className="mt-6 grid gap-3 md:grid-cols-4">
          <Stat
            icon={Database}
            label="Records"
            value={detail.metrics.totalRecords}
          />
          <Stat
            icon={Activity}
            label="Pending"
            value={detail.metrics.pendingRecords}
          />
          <Stat
            icon={Layers}
            label="Modules"
            value={detail.metrics.moduleCount}
          />
          <Stat
            icon={Workflow}
            label="Workflows"
            value={detail.metrics.workflowCount}
          />
        </section>

        <section className="mt-8">
          <SectionHeading title="Modules" />
          {detail.modules.length === 0 ? (
            <p className="text-sm text-app-faint">No modules.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {detail.modules.map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    navigate({
                      kind: "module",
                      title: `${detail.name} / ${m.name}`,
                      refId: m.id,
                      parentRefId: detail.id,
                    })
                  }
                  className="rounded-lg border border-app bg-app-elevated/50 p-4 text-left transition hover:border-app-strong hover:bg-app-surface"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{m.name}</span>
                    <span className="text-xs text-app-faint">{m.kind}</span>
                  </div>
                  {m.description && (
                    <p className="mt-1 text-xs text-app-subtle">
                      {m.description}
                    </p>
                  )}
                  <div className="mt-3 flex gap-3 text-xs text-app-faint">
                    <span>{m.entities.length} entities</span>
                    <span>{m.recordCount} records</span>
                    {m.pendingCount > 0 && (
                      <span className="text-amber-300">
                        {m.pendingCount} pending
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <SectionHeading title="Workflows" />
          {detail.workflows.length === 0 ? (
            <p className="text-sm text-app-faint">No workflows.</p>
          ) : (
            <div className="space-y-2">
              {detail.workflows.map((w) => (
                <button
                  key={w.id}
                  onClick={() =>
                    navigate({
                      kind: "workflow",
                      title: w.name,
                      refId: w.id,
                      parentRefId: detail.id,
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-lg border border-app bg-app-elevated/50 p-3 text-left text-sm hover:bg-app-surface"
                >
                  <Workflow className="h-4 w-4 text-purple-400" />
                  <span className="flex-1">{w.name}</span>
                  <span className="text-xs text-app-faint">
                    {w.triggerType}
                  </span>
                  <span className="rounded border border-app-strong px-1.5 py-0.5 text-[10px] uppercase text-app-subtle">
                    {w.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-app bg-app-elevated/50 p-3">
      <div className="flex items-center gap-2 text-xs text-app-faint">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-app">{value}</p>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-subtle">
      {title}
    </h2>
  );
}
