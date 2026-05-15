import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Calendar,
  CheckCircle2,
  FileText,
  GitBranch,
  Layers,
  Plug,
  Database,
  Home,
  LineChart,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Video,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "../components/ui/input";
import { EmptyState } from "../components/EmptyState";
import { useAppContext } from "../context/app-context";
import {
  fetchAiRequests,
  fetchActivity,
  fetchDeployments,
  fetchDocuments,
  fetchJobs,
  fetchRecords,
  fetchReports,
  fetchSchedules,
  fetchSystems,
  fetchTasks,
  listFiles,
  type AiChangeRequest,
  type ActivityLog,
  type CoworkerJob,
  type Report,
  type RuntimeRecord,
  type Schedule,
  type StoredFile,
  type SystemDeployment,
  type SystemSummary,
  type Task,
  type WorkspaceDocument,
} from "../lib/resources";
import { AssistantDock } from "./AssistantDock";
import { useWorkspace, type ActivityKey } from "./workspace-context";

const TOOL_PANELS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "marketplace", label: "Marketplace", icon: Plug },
  { id: "connections", label: "Connections", icon: Wrench },
  { id: "audit", label: "Audit Export", icon: ShieldCheck },
];

const TITLES: Record<ActivityKey, string> = {
  home: "Home",
  explorer: "Explorer",
  coworker: "Coworker",
  flow: "Flow",
  systems: "Systems",
  documents: "Documents",
  files: "Files",
  records: "Records",
  tasks: "Tasks",
  schedules: "Schedules",
  reports: "Reports",
  templates: "Templates",
  tools: "Tools",
  teams: "Teams",
  settings: "Settings",
};

export function Sidebar() {
  const { activity, navigate } = useWorkspace();
  const { currentOrganization, currentWorkspace } = useAppContext();
  const [query, setQuery] = useState("");

  if (activity === "coworker") return <AssistantDock />;

  return (
    <div className="flex h-full flex-col bg-app-surface">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-base font-semibold text-app">
          {TITLES[activity]}
        </h2>
      </div>
      {activity !== "files" && (
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-8 border-app bg-app pl-8 text-sm text-app placeholder:text-app-faint focus-visible:ring-accent"
            />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!currentOrganization || !currentWorkspace ? (
          <div className="p-3 text-xs text-app-faint">Select a workspace.</div>
        ) : activity === "home" ? (
          <HomePanel />
        ) : activity === "files" ? (
          <ExplorerPanel />
        ) : activity === "flow" ? (
          <FlowPanel query={query} />
        ) : activity === "systems" ? (
          <SystemsPanel query={query} />
        ) : activity === "documents" ? (
          <DocumentsPanel query={query} />
        ) : activity === "tasks" ? (
          <TasksPanel query={query} />
        ) : activity === "schedules" ? (
          <SchedulesPanel query={query} />
        ) : activity === "reports" ? (
          <ReportsPanel query={query} />
        ) : activity === "templates" ? (
          <TemplatesPanel />
        ) : activity === "tools" ? (
          <ToolsPanel query={query} />
        ) : activity === "teams" ? (
          <TeamsPanel />
        ) : null}
      </div>
    </div>
  );
}

function HomePanel() {
  const { navigate } = useWorkspace();
  return (
    <div className="py-1">
      <Row
        icon={Home}
        label="Workspace home"
        onClick={() => navigate({ kind: "welcome", title: "Home" })}
      />
      <Row
        icon={Bot}
        label="Recent activity"
        onClick={() => navigate({ kind: "flow", title: "Flow" })}
      />
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  meta,
  onClick,
  indent = 0,
  active,
}: {
  icon: LucideIcon;
  label: string;
  meta?: string;
  onClick: () => void;
  indent?: number;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition ${
        active
          ? "bg-accent text-accent-fg font-medium"
          : "text-app-muted hover:bg-app-hover hover:text-app"
      }`}
      style={{ paddingLeft: 12 + indent * 12 }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span
          className={`shrink-0 text-[10px] uppercase tracking-wide ${
            active ? "text-accent-fg/80" : "text-app-faint"
          }`}
        >
          {meta}
        </span>
      )}
    </button>
  );
}

function ExplorerPanel() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { openTab, activeTab } = useWorkspace();
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [openType, setOpenType] = useState("documents");

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    void Promise.all([
      listFiles({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchDocuments({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
    ]).then(([allFiles, allDocuments]) => {
      if (!live) return;
      setFiles(allFiles);
      setDocuments(allDocuments);
    });
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const groups = groupExplorerItems(files, documents);

  return (
    <div className="py-1">
      {groups.every((group) => group.items.length === 0) ? (
        <p className="px-3 py-3 text-xs text-app-faint">
          No files yet. Ask the coworker to create or find one.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="border-b border-slate-800/60 py-1">
            <Row
              icon={group.icon}
              label={group.label}
              meta={String(group.items.length)}
              onClick={() =>
                setOpenType((cur) => (cur === group.id ? "" : group.id))
              }
            />
            {openType === group.id &&
              (group.items.length === 0 ? (
                <p className="px-7 py-1 text-[11px] text-app-faint">
                  Nothing here yet.
                </p>
              ) : (
                group.items.slice(0, 40).map((item) => (
                  <Row
                    key={`${item.kind}-${item.id}`}
                    icon={FileText}
                    label={item.title}
                    meta={item.meta}
                    indent={1}
                    active={activeTab?.refId === item.id}
                    // Always open files / documents in a new tab so a
                    // user can switch between two open files without
                    // losing what they were just on.
                    onClick={() => openTab(item.route)}
                  />
                ))
              ))}
          </div>
        ))
      )}
    </div>
  );
}

function groupExplorerItems(files: StoredFile[], documents: WorkspaceDocument[]) {
  const documentItems = documents.map((document) => ({
    kind: "document",
    id: document.id,
    title: document.title,
    meta: `v${document.currentVersion}`,
    route: {
      kind: "document" as const,
      title: document.title,
      refId: document.id,
    },
  }));
  const fileItem = (file: StoredFile) => ({
    kind: "file",
    id: file.id,
    title: file.filename,
    meta: fileExtension(file.filename),
    route: { kind: "file" as const, title: file.filename, refId: file.id },
  });
  const buckets = [
    { id: "documents", label: "Documents", icon: FileText, exts: ["doc", "docx", "pdf", "txt", "md", "rtf"] },
    { id: "spreadsheets", label: "Spreadsheets", icon: FileText, exts: ["xls", "xlsx", "csv", "tsv"] },
    { id: "presentations", label: "Presentations", icon: FileText, exts: ["ppt", "pptx"] },
    { id: "images", label: "Images", icon: FileText, exts: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
    { id: "data", label: "Data", icon: FileText, exts: ["json", "xml", "yaml", "yml"] },
    { id: "other", label: "Other", icon: FileText, exts: [] },
  ];
  return buckets.map((bucket) => ({
    ...bucket,
    items:
      bucket.id === "documents"
        ? [
            ...documentItems,
            ...files
              .filter((file) => bucket.exts.includes(fileExtension(file.filename)))
              .map(fileItem),
          ]
        : files
            .filter((file) => {
              const ext = fileExtension(file.filename);
              const known = buckets.some((b) => b.exts.includes(ext));
              return bucket.id === "other" ? !known : bucket.exts.includes(ext);
            })
            .map(fileItem),
  }));
}

function fileExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext && ext !== filename.toLowerCase() ? ext : "file";
}

function FlowPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [activity, setActivity] = useState<ActivityLog[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchActivity({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setActivity(rows))
      .catch(() => live && setActivity([]));
    return () => {
      live = false;
    };
  }, [currentOrganization, currentWorkspace?.id]);

  const q = query.toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const items = activity
    .map((item) => ({
      id: item.id,
      icon: iconForActivity(item),
      label: labelForActivity(item),
      meta: item.origin,
      time: new Date(item.createdAt).getTime(),
      onClick: () => navigate(routeForActivity(item)),
    }))
    .filter((item) => match(item.label));

  return (
    <div className="py-1">
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-app-faint">
          Workspace activity will appear here.
        </p>
      ) : (
        items.slice(0, 28).map((item) => (
          <Row
            key={item.id}
            icon={item.icon}
            label={item.label}
            meta={item.meta}
            onClick={item.onClick}
          />
        ))
      )}
    </div>
  );
}

function iconForActivity(item: ActivityLog): LucideIcon {
  if (item.targetType.includes("document")) return FileText;
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
      : typeof item.metadata?.toolName === "string"
        ? item.metadata.toolName
        : item.targetType;
  return `${item.action.replace(/\./g, " ")} · ${title}`;
}

function routeForActivity(item: ActivityLog) {
  if (item.targetType === "document")
    return { kind: "document" as const, title: labelForActivity(item), refId: item.targetId };
  if (item.targetType === "task")
    return { kind: "task" as const, title: labelForActivity(item), refId: item.targetId };
  if (item.targetType === "schedule")
    return { kind: "schedule" as const, title: labelForActivity(item), refId: item.targetId };
  if (item.targetType === "report")
    return { kind: "report" as const, title: labelForActivity(item), refId: item.targetId };
  if (item.targetType === "system")
    return { kind: "system" as const, title: labelForActivity(item), refId: item.targetId };
  return { kind: "flow" as const, title: "Flow", refId: item.id };
}

function SystemsPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, activeTab } = useWorkspace();
  const [systems, setSystems] = useState<SystemSummary[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchSystems({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((next) => live && setSystems(next))
      .catch(() => live && setSystems([]));
    return () => {
      live = false;
    };
  }, [currentOrganization, currentWorkspace?.id]);

  const filtered = useMemo(
    () =>
      systems.filter(
        (system) =>
          !query || system.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [systems, query],
  );

  return (
    <div className="py-1">
      {filtered.length === 0 && (
        <p className="px-3 py-3 text-xs text-app-faint">
          No systems yet. Ask the coworker to build one.
        </p>
      )}
      {filtered.map((system) => (
        <Row
          key={system.id}
          icon={Layers}
          label={system.name}
          meta={system.status}
          active={activeTab?.refId === system.id}
          onClick={() =>
            navigate({ kind: "system", title: system.name, refId: system.id })
          }
        />
      ))}
    </div>
  );
}

function DocumentsPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, activeTab } = useWorkspace();
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchDocuments({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setDocuments(rows))
      .catch(() => live && setDocuments([]));
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const filtered = documents.filter(
    (document) =>
      !query || document.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="py-1">
      {filtered.length === 0 && (
        <p className="px-3 py-3 text-xs text-app-faint">No documents yet.</p>
      )}
      {filtered.map((document) => (
        <Row
          key={document.id}
          icon={FileText}
          label={document.title}
          meta={`v${document.currentVersion}`}
          active={activeTab?.refId === document.id}
          onClick={() =>
            navigate({
              kind: "document",
              title: document.title,
              refId: document.id,
            })
          }
        />
      ))}
    </div>
  );
}

function RecordsPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [records, setRecords] = useState<RuntimeRecord[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchRecords({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setRecords(rows))
      .catch(() => live && setRecords([]));
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const filtered = records.filter((record) =>
    !query
      ? true
      : JSON.stringify(record.data ?? {})
          .toLowerCase()
          .includes(query.toLowerCase()),
  );

  return (
    <div className="py-1">
      {filtered.length === 0 && (
        <EmptyState
          compact
          icon={Database}
          title="No records yet"
          description="Records will appear here when a system creates them."
        />
      )}
      {filtered.slice(0, 60).map((record) => (
        <Row
          key={record.id}
          icon={Database}
          label={String(record.data?.name ?? record.data?.title ?? record.id.slice(0, 8))}
          meta={record.status}
          onClick={() =>
            navigate({ kind: "record", title: "Record", refId: record.id })
          }
        />
      ))}
    </div>
  );
}

function TasksPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchTasks({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setTasks(rows))
      .catch(() => live && setTasks([]));
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const filtered = tasks.filter(
    (task) => !query || task.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="py-1">
      {filtered.length === 0 && (
        <EmptyState
          compact
          icon={CheckCircle2}
          title="No tasks yet"
          description="Tasks assigned to you or your Coworker will land here."
        />
      )}
      {filtered.map((task) => (
        <Row
          key={task.id}
          icon={CheckCircle2}
          label={task.title}
          meta={task.status}
          onClick={() => navigate({ kind: "task", title: task.title, refId: task.id })}
        />
      ))}
    </div>
  );
}

function SchedulesPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchSchedules({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setSchedules(rows))
      .catch(() => live && setSchedules([]));
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const filtered = schedules.filter(
    (schedule) =>
      !query || schedule.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="py-1">
      <Row
        icon={Video}
        label="Meeting bot"
        meta="LIVE"
        onClick={() =>
          navigate({ kind: "meeting-bot", title: "Meeting bot" })
        }
      />
      {filtered.length === 0 && (
        <EmptyState
          compact
          icon={Calendar}
          title="No schedules yet"
          description="Ask Coworker to run a job on a schedule and it'll appear here."
        />
      )}
      {filtered.map((schedule) => (
        <Row
          key={schedule.id}
          icon={Calendar}
          label={schedule.title}
          meta={schedule.status}
          onClick={() =>
            navigate({ kind: "schedule", title: schedule.title, refId: schedule.id })
          }
        />
      ))}
    </div>
  );
}

function ReportsPanel({ query }: { query: string }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    if (!currentOrganization) return;
    let live = true;
    fetchReports({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => live && setReports(rows))
      .catch(() => live && setReports([]));
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const filtered = reports.filter(
    (report) => !query || report.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="py-1">
      {filtered.length === 0 && (
        <EmptyState
          compact
          icon={LineChart}
          title="No reports yet"
          description="Reports built from your systems show up here."
        />
      )}
      {filtered.map((report) => (
        <Row
          key={report.id}
          icon={LineChart}
          label={report.title}
          meta={report.sourceType}
          onClick={() =>
            navigate({ kind: "report", title: report.title, refId: report.id })
          }
        />
      ))}
    </div>
  );
}

function TemplatesPanel() {
  const { navigate } = useWorkspace();
  return (
    <div className="py-1">
      <Row
        icon={Layers}
        label="Browse templates"
        onClick={() => navigate({ kind: "templates", title: "Templates" })}
      />
    </div>
  );
}

function ToolsPanel({ query }: { query: string }) {
  const { navigate, activeTab } = useWorkspace();
  const filtered = TOOL_PANELS.filter(
    (tool) => !query || tool.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="py-1">
      {filtered.map((tool) => (
        <Row
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          active={activeTab?.kind === "tools" && activeTab.refId === tool.id}
          onClick={() =>
            navigate({ kind: "tools", title: tool.label, refId: tool.id })
          }
        />
      ))}
    </div>
  );
}

function TeamsPanel() {
  const { navigate } = useWorkspace();
  return (
    <div className="py-1">
      <Row
        icon={Users}
        label="Members & Roles"
        onClick={() => navigate({ kind: "teams", title: "Teams" })}
      />
    </div>
  );
}

// SettingsPanel was a sidebar list of Settings sections that
// duplicated the dialog's own sidenav. Replaced by the SettingsDialog
// modal — trigger via window.dispatchEvent("stack62:open-settings").
