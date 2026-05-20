import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "../workspace-context";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

/**
 * Editors are lazy-loaded so the initial bundle stays small and each
 * editor only loads on first use. The welcome / file editors are
 * eager because they're the most common entry points; everything
 * else is split.
 */
import { WelcomeEditor } from "./WelcomeEditor";
import { FileEditor } from "./FileEditor";

const BriefingEditor = lazy(() =>
  import("./BriefingEditor").then((m) => ({ default: m.BriefingEditor })),
);
const FilesExplorerEditor = lazy(() =>
  import("./FilesExplorerEditor").then((m) => ({
    default: m.FilesExplorerEditor,
  })),
);
const HistoryEditor = lazy(() =>
  import("./HistoryEditor").then((m) => ({ default: m.HistoryEditor })),
);
const InboxEditor = lazy(() =>
  import("./InboxEditor").then((m) => ({ default: m.InboxEditor })),
);
const JobEditor = lazy(() =>
  import("./JobEditor").then((m) => ({ default: m.JobEditor })),
);
const ModuleEditor = lazy(() =>
  import("./ModuleEditor").then((m) => ({ default: m.ModuleEditor })),
);
const PlanEditor = lazy(() =>
  import("./PlanEditor").then((m) => ({ default: m.PlanEditor })),
);
const PreviewEditor = lazy(() =>
  import("./PreviewEditor").then((m) => ({ default: m.PreviewEditor })),
);
const ReportEditor = lazy(() =>
  import("./ReportEditor").then((m) => ({ default: m.ReportEditor })),
);
const RoomEditor = lazy(() =>
  import("./RoomEditor").then((m) => ({ default: m.RoomEditor })),
);
const ScheduleEditor = lazy(() =>
  import("./ScheduleEditor").then((m) => ({ default: m.ScheduleEditor })),
);
const MeetingBotEditor = lazy(() =>
  import("./MeetingBotEditor").then((m) => ({ default: m.MeetingBotEditor })),
);
const WorkspaceDocEditor = lazy(() =>
  import("./WorkspaceDocEditor").then((m) => ({
    default: m.WorkspaceDocEditor,
  })),
);
const ShareEditor = lazy(() =>
  import("./ShareEditor").then((m) => ({ default: m.ShareEditor })),
);
const StreamingDocEditor = lazy(() =>
  import("./StreamingDocEditor").then((m) => ({
    default: m.StreamingDocEditor,
  })),
);
const SystemEditor = lazy(() =>
  import("./SystemEditor").then((m) => ({ default: m.SystemEditor })),
);
const TaskEditor = lazy(() =>
  import("./TaskEditor").then((m) => ({ default: m.TaskEditor })),
);
const TeamsEditor = lazy(() =>
  import("./TeamsEditor").then((m) => ({ default: m.TeamsEditor })),
);
const TemplatesEditor = lazy(() =>
  import("./TemplatesEditor").then((m) => ({ default: m.TemplatesEditor })),
);
const ToolsEditor = lazy(() =>
  import("./ToolsEditor").then((m) => ({ default: m.ToolsEditor })),
);
const WorkflowEditor = lazy(() =>
  import("./WorkflowEditor").then((m) => ({ default: m.WorkflowEditor })),
);

function EditorFallback() {
  return (
    <div className="grid h-full place-items-center bg-app">
      <div className="flex items-center gap-2 text-sm text-app-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading editor…
      </div>
    </div>
  );
}

export function EditorSurface() {
  const { activeTab } = useWorkspace();
  if (!activeTab) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint" />
    );
  }
  // Reset the error boundary whenever the active tab id changes so a
  // previously crashed editor doesn't permanently lock out a new one.
  return (
    <EditorErrorBoundary resetKey={activeTab.id}>
      <Suspense fallback={<EditorFallback />}>
        <RenderEditor />
      </Suspense>
    </EditorErrorBoundary>
  );
}

function RenderEditor() {
  const { activeTab } = useWorkspace();
  if (!activeTab) return null;
  switch (activeTab.kind) {
    case "welcome":
      return <WelcomeEditor />;
    case "file":
    case "document":
      return <FileEditor key={activeTab.id} tab={activeTab} />;
    case "system":
      return <SystemEditor key={activeTab.id} tab={activeTab} />;
    case "module":
      return <ModuleEditor key={activeTab.id} tab={activeTab} />;
    case "task":
      return <TaskEditor key={activeTab.id} tab={activeTab} />;
    case "report":
      return <ReportEditor key={activeTab.id} tab={activeTab} />;
    case "workflow":
      return <WorkflowEditor key={activeTab.id} tab={activeTab} />;
    case "schedule":
      return <ScheduleEditor key={activeTab.id} tab={activeTab} />;
    case "meeting-bot":
      return <MeetingBotEditor key={activeTab.id} tab={activeTab} />;
    case "workspace-doc":
      return <WorkspaceDocEditor key={activeTab.id} tab={activeTab} />;
    case "plan":
      return <PlanEditor key={activeTab.id} tab={activeTab} />;
    case "preview":
      return <PreviewEditor key={activeTab.id} tab={activeTab} />;
    case "history":
      return <HistoryEditor key={activeTab.id} tab={activeTab} />;
    case "share":
      return <ShareEditor key={activeTab.id} tab={activeTab} />;
    case "tools":
      return <ToolsEditor key={activeTab.id} tab={activeTab} />;
    case "teams":
      return <TeamsEditor />;
    case "inbox":
      return <InboxEditor />;
    case "job":
      return <JobEditor key={activeTab.id} tab={activeTab} />;
    case "flow":
      return <BriefingEditor />;
    case "templates":
      return <TemplatesEditor />;
    case "files-explorer":
      return <FilesExplorerEditor />;
    case "room":
      return <RoomEditor key={activeTab.id} />;
    case "streaming-doc":
      return <StreamingDocEditor />;
    case "settings":
      // Settings is a modal dialog now (SettingsDialog mounted at the
      // Workspace root). Anything that still navigates here drops to
      // the welcome surface and we open the dialog via the global
      // event so the user lands somewhere sane.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("stack62:open-settings"));
      }
      return <WelcomeEditor />;
    default:
      return <WelcomeEditor />;
  }
}
