import { useEffect, useRef, useState } from "react";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { CoworkerRail } from "./CoworkerRail";
import { EditorSurface } from "./editors";
import { SettingsDialog } from "./editors/SettingsEditor";
import { EmailComposer } from "./EmailComposer";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";
import { useGlobalShortcuts } from "./use-shortcuts";
import { useWorkspace, WorkspaceProvider } from "./workspace-context";
import { AppDialogHost } from "../components/app-dialog";
import { useAppContext } from "../context/app-context";
import { fetchDashboard, type WorkspaceDashboard } from "../lib/resources";

export function Workspace() {
  return (
    <WorkspaceProvider>
      <Inner />
    </WorkspaceProvider>
  );
}

function useDocumentFocusMode() {
  const { activeTab, sidebarOpen, setSidebarOpen } = useWorkspace();
  const lastTabId = useRef<string | null>(null);
  useEffect(() => {
    const id = activeTab?.id ?? null;
    if (id !== lastTabId.current) {
      lastTabId.current = id;
      const kind = activeTab?.kind;
      if (
        sidebarOpen &&
        (kind === "file" ||
          kind === "document" ||
          kind === "report" ||
          kind === "preview" ||
          kind === "files-explorer")
      ) {
        setSidebarOpen(false);
      }
    }
  }, [activeTab, sidebarOpen, setSidebarOpen]);
}

/** Poll the dashboard endpoint so the decisions badge and home screen stay fresh. */
function useDashboardPoll(intervalMs = 30_000) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | null>(null);

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) return;
    let live = true;
    const load = async () => {
      try {
        const data = await fetchDashboard({
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace.id,
        });
        if (live) setDashboard(data);
      } catch {
        /* silent — badge just won't show */
      }
    };
    void load();
    const id = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [currentOrganization?.id, currentWorkspace?.id, intervalMs]);

  return dashboard;
}

function Inner() {
  useGlobalShortcuts();
  useDocumentFocusMode();
  const composer = useEmailComposer();
  const dashboard = useDashboardPoll();
  const pendingDecisions =
    (dashboard?.pendingAiRequests ?? 0) + (dashboard?.activeWorkflowRuns ?? 0);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app text-app">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar decisionCount={pendingDecisions} />
        <SidebarColumn dashboard={dashboard} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <main className="min-h-0 flex-1 overflow-hidden">
            <EditorSurface />
          </main>
        </div>
        <CoworkerRail />
      </div>
      <StatusBar />
      <CommandPalette />
      <EmailComposer
        open={composer.open}
        onClose={composer.close}
        initialTo={composer.initial.to}
        initialSubject={composer.initial.subject}
        initialBody={composer.initial.body}
      />
      <SettingsDialog />
      <AppDialogHost />
    </div>
  );
}

function useEmailComposer() {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState({ to: "", subject: "", body: "" });
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        to?: string;
        subject?: string;
        body?: string;
      }>).detail ?? {};
      setInitial({
        to: detail.to ?? "",
        subject: detail.subject ?? "",
        body: detail.body ?? "",
      });
      setOpen(true);
    };
    window.addEventListener("stack62:open-email", handler);
    return () => window.removeEventListener("stack62:open-email", handler);
  }, []);
  return { open, initial, close: () => setOpen(false) };
}

function SidebarColumn({ dashboard }: { dashboard: WorkspaceDashboard | null }) {
  const { sidebarOpen, setSidebarOpen } = useWorkspace();
  if (!sidebarOpen) return null;
  return (
    <>
      {/* Mobile: translucent overlay that closes sidebar on tap */}
      <div
        className="fixed inset-0 z-20 bg-black/40 md:hidden"
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />
      <div className="fixed inset-y-0 left-12 z-20 flex w-72 shrink-0 flex-col border-r border-app bg-app-surface sm:left-14 md:relative md:inset-auto md:z-auto md:w-80">
        <Sidebar dashboard={dashboard} />
      </div>
    </>
  );
}
