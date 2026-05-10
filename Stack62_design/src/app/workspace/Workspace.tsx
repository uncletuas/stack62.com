import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { CoworkerRail } from "./CoworkerRail";
import { EditorSurface } from "./editors";
import { RunPanel } from "./RunPanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";
import { useGlobalShortcuts } from "./use-shortcuts";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";

export function Workspace() {
  return (
    <WorkspaceProvider>
      <Inner />
    </WorkspaceProvider>
  );
}

function Inner() {
  useGlobalShortcuts();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app text-app">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />
        <SidebarColumn />
        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <main className="min-h-0 flex-1 overflow-hidden">
            <EditorSurface />
          </main>
          <RunPanel />
        </div>
        <CoworkerRail />
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  );
}

function SidebarColumn() {
  const { sidebarOpen } = useWorkspace();
  if (!sidebarOpen) return null;
  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-app bg-app-surface">
      <Sidebar />
    </div>
  );
}
