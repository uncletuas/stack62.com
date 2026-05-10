import {
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronDown,
  Command,
  Download,
  FileDown,
  FolderOpen,
  HelpCircle,
  Layers,
  LogOut,
  PanelLeft,
  Plus,
  Printer,
  Search,
  Sparkles,
  Terminal,
  Upload,
} from "lucide-react";
import { useAppContext } from "../context/app-context";
import { auditExportCsvUrl, fetchRecords, uploadFile } from "../lib/resources";
import { Menu, type MenuItem } from "./Menu";
import { useWorkspace } from "./workspace-context";

export function TitleBar() {
  const {
    setPaletteOpen,
    openTab,
    activeTab,
    setActivity,
    sidebarOpen,
    setSidebarOpen,
    runOpen,
    setRunOpen,
    appendRunLog,
    back,
    forward,
    autopilot,
    setAutopilot,
    navigate,
  } = useWorkspace();
  const { currentOrganization, currentWorkspace, logout } = useAppContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const openCoworker = () => {
    setActivity("coworker");
    setSidebarOpen(true);
  };

  const openNotifications = () => {
    setActivity("settings");
    setSidebarOpen(true);
    navigate({
      kind: "settings",
      title: "Settings - Notifications",
      refId: "notifications",
    });
  };

  const importFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!currentOrganization) {
      appendRunLog({
        level: "warn",
        text: "Choose an organization before importing files.",
        source: "files",
      });
      return;
    }

    const files = Array.from(list);
    let firstUploadedId: string | null = null;
    let firstUploadedName = "";

    for (const file of files) {
      try {
        const uploaded = await uploadFile({
          file,
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace?.id,
          scope: "attachment",
          ownerKind: "explorer",
        });
        firstUploadedId ??= uploaded.id;
        firstUploadedName ||= uploaded.filename;
      } catch (err) {
        appendRunLog({
          level: "error",
          text: `Import failed for ${file.name}: ${(err as Error).message}`,
          source: "files",
        });
      }
    }

    if (firstUploadedId) {
      navigate({
        kind: "file",
        title: firstUploadedName,
        refId: firstUploadedId,
      });
      appendRunLog({
        level: "ok",
        text: `Imported ${files.length} file${files.length === 1 ? "" : "s"}`,
        source: "files",
      });
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void importFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const fileItems: MenuItem[] = [
    {
      label: "Import files",
      icon: Upload,
      onSelect: () => fileInputRef.current?.click(),
    },
    {
      label: "Import folder",
      icon: FolderOpen,
      onSelect: () => folderInputRef.current?.click(),
    },
    {
      label: "Print current view",
      icon: Printer,
      shortcut: "Ctrl+P",
      onSelect: () => window.print(),
    },
    {
      label: "Search workspace",
      icon: Search,
      separatorAbove: true,
      onSelect: () => setPaletteOpen(true),
    },
    {
      label: "Open coworker",
      icon: Sparkles,
      onSelect: openCoworker,
    },
    {
      label: "Sign out",
      icon: LogOut,
      separatorAbove: true,
      onSelect: () => logout(),
    },
  ];

  const exportItems: MenuItem[] = [
    {
      label: "Print current view",
      icon: Printer,
      shortcut: "Ctrl+P",
      onSelect: () => window.print(),
    },
    {
      label: "Export module records (CSV)",
      icon: FileDown,
      disabled:
        activeTab?.kind !== "module" || !activeTab.refId || !activeTab.parentRefId,
      onSelect: async () => {
        if (
          !currentOrganization ||
          !activeTab ||
          !activeTab.refId ||
          !activeTab.parentRefId
        )
          return;
        try {
          const records = await fetchRecords({
            organizationId: currentOrganization.id,
            workspaceId: currentWorkspace?.id,
            systemId: activeTab.parentRefId,
            moduleDefinitionId: activeTab.refId,
          });
          const csv = recordsToCsv(records);
          downloadFile(`${activeTab.title || "records"}.csv`, csv, "text/csv");
          appendRunLog({
            level: "ok",
            text: `Exported ${records.length} records`,
            source: "export",
          });
        } catch (err) {
          appendRunLog({
            level: "error",
            text: `Export failed: ${(err as Error).message}`,
            source: "export",
          });
        }
      },
    },
    {
      label: "Download workspace audit log (CSV)",
      icon: Download,
      separatorAbove: true,
      onSelect: () => {
        if (!currentOrganization) return;
        window.open(
          auditExportCsvUrl({
            organizationId: currentOrganization.id,
            workspaceId: currentWorkspace?.id,
          }),
          "_blank",
        );
      },
    },
  ];

  const viewItems: MenuItem[] = [
    {
      label: sidebarOpen ? "Hide sidebar" : "Show sidebar",
      icon: PanelLeft,
      shortcut: "Ctrl+B",
      onSelect: () => setSidebarOpen(!sidebarOpen),
    },
    {
      label: runOpen ? "Hide output panel" : "Show output panel",
      icon: Terminal,
      shortcut: "Ctrl+J",
      onSelect: () => setRunOpen(!runOpen),
    },
    {
      label: "Command palette",
      icon: Command,
      shortcut: "Ctrl+K",
      onSelect: () => setPaletteOpen(true),
    },
  ];

  const helpItems: MenuItem[] = [
    {
      label: "Open coworker",
      icon: Sparkles,
      onSelect: openCoworker,
    },
    {
      label: "Keyboard shortcuts",
      icon: HelpCircle,
      onSelect: () =>
        appendRunLog({
          level: "info",
          text: "Ctrl+K palette · Ctrl+B sidebar · Ctrl+J output · Ctrl+T coworker",
          source: "help",
        }),
    },
  ];

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-app bg-app px-3 text-xs">
      <span className="flex items-center gap-1 font-semibold tracking-tight text-white">
        <Layers className="h-3.5 w-3.5 text-indigo-400" />
        Stack62
      </span>

      <div className="ml-1 flex items-center gap-1">
        <Menu
          trigger={
            <>
              File <ChevronDown className="h-3 w-3" />
            </>
          }
          items={fileItems}
        />
        <Menu
          trigger={
            <>
              Export <ChevronDown className="h-3 w-3" />
            </>
          }
          items={exportItems}
        />
        <Menu
          trigger={
            <>
              View <ChevronDown className="h-3 w-3" />
            </>
          }
          items={viewItems}
        />
        <Menu
          trigger={
            <>
              Help <ChevronDown className="h-3 w-3" />
            </>
          }
          items={helpItems}
        />
      </div>

      <div className="ml-3 flex items-center gap-0.5 border-l border-app pl-3">
        <button
          onClick={() => back()}
          disabled={!activeTab?.canGoBack}
          className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => forward()}
          disabled={!activeTab?.canGoForward}
          className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => openTab({ kind: "welcome", title: "Welcome" })}
          className="ml-1 grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white"
          title="Home"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setAutopilot(!autopilot)}
        className={`ml-auto flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition ${
          autopilot
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-app bg-app-surface text-app-subtle hover:border-app-strong hover:text-app"
        }`}
        title={autopilot ? "Coworker is active" : "Coworker is off"}
      >
        <span
          className={`relative inline-block h-3 w-6 rounded-full transition ${
            autopilot ? "bg-emerald-500" : "bg-slate-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${
              autopilot ? "left-3.5" : "left-0.5"
            }`}
          />
        </span>
        <span>{autopilot ? "Coworker on" : "Coworker off"}</span>
      </button>

      <button
        onClick={() => setPaletteOpen(true)}
        className="flex w-72 items-center gap-2 rounded border border-app bg-app-surface px-2 py-1 text-app-faint hover:border-app-strong hover:text-app-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Search</span>
        <kbd className="ml-auto rounded border border-app px-1 text-[10px]">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={openNotifications}
        className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInput}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInput}
        {...folderInputProps}
      />
    </header>
  );
}

const folderInputProps = {
  webkitdirectory: "",
  directory: "",
} as unknown as InputHTMLAttributes<HTMLInputElement>;

function recordsToCsv(
  rows: Array<{
    id: string;
    status: string;
    data: Record<string, unknown>;
    updatedAt: string;
  }>,
) {
  if (rows.length === 0) return "id,status,updatedAt\n";
  const dataKeys = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r.data ?? {}))),
  );
  const header = ["id", "status", "updatedAt", ...dataKeys];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escape(r.id),
        escape(r.status),
        escape(r.updatedAt),
        ...dataKeys.map((k) => escape((r.data as Record<string, unknown>)?.[k])),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
