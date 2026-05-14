import { useWorkspace } from "../workspace-context";
import { BriefingEditor } from "./BriefingEditor";
import { FileEditor } from "./FileEditor";
import { FilesExplorerEditor } from "./FilesExplorerEditor";
import { HistoryEditor } from "./HistoryEditor";
import { InboxEditor } from "./InboxEditor";
import { JobEditor } from "./JobEditor";
import { ModuleEditor } from "./ModuleEditor";
import { PlanEditor } from "./PlanEditor";
import { PreviewEditor } from "./PreviewEditor";
import { RecordEditor } from "./RecordEditor";
import { ReportEditor } from "./ReportEditor";
import { RoomEditor } from "./RoomEditor";
import { ScheduleEditor } from "./ScheduleEditor";
import { StreamingDocEditor } from "./StreamingDocEditor";
import { SettingsEditor } from "./SettingsEditor";
import { ShareEditor } from "./ShareEditor";
import { SystemEditor } from "./SystemEditor";
import { TeamsEditor } from "./TeamsEditor";
import { TemplatesEditor } from "./TemplatesEditor";
import { TaskEditor } from "./TaskEditor";
import { ToolsEditor } from "./ToolsEditor";
import { WelcomeEditor } from "./WelcomeEditor";
import { WorkflowEditor } from "./WorkflowEditor";

export function EditorSurface() {
  const { activeTab } = useWorkspace();
  if (!activeTab) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint" />
    );
  }
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
    case "record":
      return <RecordEditor key={activeTab.id} tab={activeTab} />;
    case "task":
      return <TaskEditor key={activeTab.id} tab={activeTab} />;
    case "report":
      return <ReportEditor key={activeTab.id} tab={activeTab} />;
    case "workflow":
      return <WorkflowEditor key={activeTab.id} tab={activeTab} />;
    case "schedule":
      return <ScheduleEditor key={activeTab.id} tab={activeTab} />;
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
      return <RoomEditor />;
    case "streaming-doc":
      return <StreamingDocEditor />;
    case "settings":
      return <SettingsEditor key={activeTab.id} tab={activeTab} />;
    default:
      return <WelcomeEditor />;
  }
}
