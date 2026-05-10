import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  Layers,
  LineChart,
  Loader2,
  Newspaper,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../context/app-context";
import {
  fetchActivity,
  type ActivityLog,
} from "../../lib/resources";
import { useWorkspace, type EditorKind } from "../workspace-context";

export function BriefingEditor() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!currentOrganization) return;
    setLoading(true);
    const rows = await fetchActivity({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    }).catch(() => []);
    setActivity(rows);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const items = useMemo(
    () =>
      activity
        .map((item) => ({
          ...item,
          icon: iconForActivity(item),
          label: labelForActivity(item),
          meta: metaForActivity(item),
          route: routeForActivity(item),
          time: new Date(item.createdAt).getTime(),
        }))
        .sort((a, b) => b.time - a.time),
    [activity],
  );

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-5xl p-6">
        <header className="mb-5 flex items-end justify-between gap-3 border-b border-app pb-4">
          <div className="flex items-center gap-3">
            <Newspaper className="h-5 w-5 text-cyan-300" />
            <div>
              <h1 className="text-xl font-semibold">Flow</h1>
              <p className="text-xs text-app-faint">
                Unified activity across documents, systems, tasks, reports, and coworker actions
              </p>
            </div>
          </div>
          <Button
            onClick={() => void reload()}
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </header>

        <section className="rounded-lg border border-app bg-slate-900/35">
          <header className="flex items-center gap-2 border-b border-slate-800/80 px-4 py-2">
            <Clock className="h-3.5 w-3.5 text-app-subtle" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-app-muted">
              Workspace stream
            </h2>
            <span className="text-xs text-app-faint">{items.length}</span>
          </header>
          {items.length === 0 ? (
            <p className="px-4 py-5 text-sm text-app-faint">
              Workspace activity will appear here as Stack62 creates and changes work objects.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {items.slice(0, 80).map((item) => (
                <ActivityRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  meta={item.meta}
                  origin={item.origin}
                  onClick={() => navigate(item.route)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function iconForActivity(item: ActivityLog): LucideIcon {
  if (item.targetType.includes("document")) return FileText;
  if (item.targetType.includes("file")) return FileText;
  if (item.targetType.includes("task")) return CheckCircle2;
  if (item.targetType.includes("schedule")) return Calendar;
  if (item.targetType.includes("report")) return LineChart;
  if (item.targetType.includes("record")) return Database;
  if (item.targetType.includes("system")) return Layers;
  return Bot;
}

function labelForActivity(item: ActivityLog) {
  const title =
    typeof item.metadata?.title === "string"
      ? item.metadata.title
      : typeof item.metadata?.name === "string"
        ? item.metadata.name
        : typeof item.metadata?.toolName === "string"
          ? item.metadata.toolName
          : item.targetType;
  return `${item.action.replace(/\./g, " ")} · ${title}`;
}

function metaForActivity(item: ActivityLog) {
  const time = new Date(item.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${item.origin} · ${time}`;
}

function routeForActivity(item: ActivityLog) {
  const kind = routeKind(item.targetType);
  if (!kind) return { kind: "flow" as const, title: "Flow", refId: item.id };
  return { kind, title: labelForActivity(item), refId: item.targetId };
}

function routeKind(targetType: string): EditorKind | null {
  if (targetType.includes("document")) return "document";
  if (targetType.includes("file")) return "file";
  if (targetType.includes("task")) return "task";
  if (targetType.includes("schedule")) return "schedule";
  if (targetType.includes("report")) return "report";
  if (targetType.includes("record")) return "record";
  if (targetType.includes("system")) return "system";
  return null;
}

function ActivityRow({
  icon: Icon,
  label,
  meta,
  origin,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  meta: string;
  origin: ActivityLog["origin"];
  onClick: () => void;
}) {
  const color =
    origin === "ai"
      ? "text-cyan-300"
      : origin === "system"
        ? "text-app-subtle"
        : "text-emerald-300";
  return (
    <button
      onClick={onClick}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5"
    >
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className="truncate text-app">{label}</span>
      <span className="text-[11px] text-app-faint">{meta}</span>
    </button>
  );
}
