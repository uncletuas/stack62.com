import { useEffect, useRef, useState } from "react";
import { ActivityBar } from "./ActivityBar";
import { CommandPalette } from "./CommandPalette";
import { CoworkerRail } from "./CoworkerRail";
import { EditorSurface } from "./editors";
import { SettingsDialog } from "./editors/SettingsEditor";
import { EmailComposer } from "./EmailComposer";
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

/**
 * Focus-mode: when the user opens a file or document tab, collapse
 * the left sidebar so they get the full canvas. We trigger this
 * exactly once per *transition into* a document tab — if the user
 * re-opens the sidebar manually we leave them alone.
 */
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
          // Files-explorer has its own filter chips + grid; the
          // sidebar's "by-type" list duplicates them.
          kind === "files-explorer")
      ) {
        setSidebarOpen(false);
      }
    }
  }, [activeTab, sidebarOpen, setSidebarOpen]);
}

function Inner() {
  useGlobalShortcuts();
  useDocumentFocusMode();
  const composer = useEmailComposer();
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
      <EmailComposer
        open={composer.open}
        onClose={composer.close}
        initialTo={composer.initial.to}
        initialSubject={composer.initial.subject}
        initialBody={composer.initial.body}
      />
      <SettingsDialog />
    </div>
  );
}

/**
 * Global email-composer state. The window-level `stack62:open-email`
 * custom event lets any component — Coworker tools, top-bar menu,
 * file share buttons — open the composer with prefilled values
 * without needing a context.
 */
function useEmailComposer() {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState({
    to: "",
    subject: "",
    body: "",
  });
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

function SidebarColumn() {
  const { sidebarOpen } = useWorkspace();
  if (!sidebarOpen) return null;
  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-app bg-app-surface">
      <Sidebar />
    </div>
  );
}
