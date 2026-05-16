import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Command,
  Download,
  FileDown,
  FolderOpen,
  HelpCircle,
  Layers,
  LogOut,
  Mail,
  PanelLeft,
  Settings as SettingsIcon,
  Plus,
  Printer,
  Search,
  Sparkles,
  Terminal,
  Upload,
  User as UserIcon,
} from "lucide-react";
import { useAppContext } from "../context/app-context";
import {
  auditExportCsvUrl,
  fetchAiRequests,
  fetchRecords,
  fetchWorkflowRuns,
  uploadFile,
  userAvatarUrl,
} from "../lib/resources";
import { type MenuItem } from "./Menu";
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

  const [notifOpen, setNotifOpen] = useState(false);

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
      // Open imported file in a new tab — preserves whatever the user
      // was previously looking at.
      openTab({
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
      label: "New email",
      icon: Mail,
      onSelect: () =>
        window.dispatchEvent(new CustomEvent("stack62:open-email")),
    },
    {
      label: "Import files",
      icon: Upload,
      separatorAbove: true,
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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-app bg-app-surface px-3 text-sm">
      {/* Logo */}
      <span className="flex items-center gap-1.5 font-semibold tracking-tight text-app">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-accent-fg">
          <Layers className="h-3.5 w-3.5" />
        </span>
        Stack62
      </span>

      {/* Back / forward / new tab */}
      <div className="ml-2 flex items-center gap-0.5">
        <button
          onClick={() => back()}
          disabled={!activeTab?.canGoBack}
          className="grid h-7 w-7 place-items-center rounded-md text-app-subtle hover:bg-app-hover hover:text-app disabled:cursor-not-allowed disabled:text-app-faint disabled:hover:bg-transparent"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => forward()}
          disabled={!activeTab?.canGoForward}
          className="grid h-7 w-7 place-items-center rounded-md text-app-subtle hover:bg-app-hover hover:text-app disabled:cursor-not-allowed disabled:text-app-faint disabled:hover:bg-transparent"
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => openTab({ kind: "welcome", title: "Welcome" })}
          className="ml-1 grid h-7 w-7 place-items-center rounded-md text-app-subtle hover:bg-app-hover hover:text-app"
          title="Home"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Centered search — collapses to icon-only below sm. */}
      <div className="mx-auto hidden w-full max-w-2xl items-center px-4 sm:flex">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-app bg-app px-3 py-1.5 text-sm text-app-faint hover:border-app-strong hover:text-app-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search Stack62</span>
          <kbd className="rounded border border-app px-1 text-[10px] text-app-faint">
            ⌘ K
          </kbd>
        </button>
      </div>
      <button
        onClick={() => setPaletteOpen(true)}
        className="ml-auto grid h-8 w-8 place-items-center rounded-md text-app-subtle hover:bg-app-hover hover:text-app sm:hidden"
        title="Search"
      >
        <Search className="h-4 w-4" />
      </button>

      {/* Right side: bell + profile */}
      <div className="flex items-center gap-1">
        <NotificationsBell open={notifOpen} setOpen={setNotifOpen} />
        <ProfileMenu
          fileItems={fileItems}
          exportItems={exportItems}
          viewItems={viewItems}
          helpItems={helpItems}
          autopilot={autopilot}
          setAutopilot={setAutopilot}
          onSignOut={logout}
        />
      </div>

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

/**
 * Top-bar notification bell. Pulls recent AI requests, workflow runs
 * waiting on approval, and any room mentions of the current user from
 * the existing endpoints. The Notifications "settings page" is gone
 * — this is the single place notifications live now.
 */
function NotificationsBell({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (next: boolean) => void;
}) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [items, setItems] = useState<
    Array<{
      id: string;
      kind: "plan" | "approval" | "system";
      title: string;
      detail: string;
      createdAt: string;
      open?: () => void;
    }>
  >([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !currentOrganization) return;
    let live = true;
    (async () => {
      try {
        const [plans, runs] = await Promise.all([
          fetchAiRequests({
            organizationId: currentOrganization.id,
            workspaceId: currentWorkspace?.id,
            status: "pending",
          }),
          fetchWorkflowRuns({
            organizationId: currentOrganization.id,
            workspaceId: currentWorkspace?.id,
            status: "active",
          }),
        ]);
        if (!live) return;
        const planItems = plans.map((p) => ({
          id: `plan-${p.id}`,
          kind: "plan" as const,
          title: p.title || "Plan awaiting review",
          detail: p.summary?.slice(0, 120) ?? "Review and approve.",
          createdAt: p.createdAt,
          open: () => {
            navigate({
              kind: "plan",
              title: p.title || "Plan",
              refId: p.id,
            });
            setOpen(false);
          },
        }));
        const approvalItems = runs
          .filter((r) => r.status === "active" && !r.nextRunAt)
          .map((r) => ({
            id: `run-${r.id}`,
            kind: "approval" as const,
            title: "Workflow waiting on approval",
            detail: r.workflow?.name ?? "Workflow run",
            createdAt: r.createdAt,
            open: () => {
              navigate({
                kind: "workflow",
                title: r.workflow?.name ?? "Workflow",
                refId: r.workflowId,
              });
              setOpen(false);
            },
          }));
        setItems(
          [...planItems, ...approvalItems].sort((a, b) =>
            (b.createdAt || "").localeCompare(a.createdAt || ""),
          ),
        );
      } catch {
        if (live) setItems([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [open, currentOrganization, currentWorkspace, navigate, setOpen]);

  // Close on outside-click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open, setOpen]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10 hover:text-white"
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {items.length > 0 && (
          <span className="absolute right-1 top-1 grid h-3 min-w-3 place-items-center rounded-full bg-cyan-400 px-0.5 text-[9px] font-semibold text-slate-950">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-md border border-app bg-app-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-app px-3 py-2">
            <p className="text-xs font-semibold">Notifications</p>
            <span className="text-[10px] text-app-faint">
              {items.length === 0
                ? "All caught up"
                : `${items.length} pending`}
            </span>
          </div>
          <div className="max-h-96 overflow-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-app-faint">
                No new notifications.
              </p>
            ) : (
              <ul className="py-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={item.open}
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-app-hover"
                    >
                      <span className="text-xs font-medium">{item.title}</span>
                      <span className="line-clamp-2 text-[11px] text-app-faint">
                        {item.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Profile menu. Collapses the old File/Export/View/Help menu bar plus
 * the autopilot toggle + sign-out into a single round avatar at the
 * top-right. Slack does this. Big space-saving win, fewer chrome
 * elements to scan.
 */
function ProfileMenu({
  fileItems,
  exportItems,
  viewItems,
  helpItems,
  autopilot,
  setAutopilot,
  onSignOut,
}: {
  fileItems: MenuItem[];
  exportItems: MenuItem[];
  viewItems: MenuItem[];
  helpItems: MenuItem[];
  autopilot: boolean;
  setAutopilot: (next: boolean) => void;
  onSignOut: () => void;
}) {
  const { user } = useAppContext();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const initials = (() => {
    const f = user?.firstName?.[0] ?? "";
    const l = user?.lastName?.[0] ?? "";
    return (f + l).toUpperCase() || "U";
  })();
  const avatarSrc =
    user?.avatarFileId && user.id
      ? userAvatarUrl(user.id, user.updatedAt ?? "")
      : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-accent text-[12px] font-semibold text-accent-fg shadow-sm hover:bg-accent-hover"
        title={user ? `${user.firstName} ${user.lastName}` : "Account"}
      >
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={user ? `${user.firstName} ${user.lastName}` : "Account"}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Fall back to initials if the image fails (404, server
              // down, etc.) by hiding the image — the parent button
              // background is the accent color so initials would show
              // through, but we'd be left empty. Instead swap to the
              // initials node.
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const sibling = (e.currentTarget as HTMLImageElement)
                .nextElementSibling as HTMLElement | null;
              if (sibling) sibling.style.display = "grid";
            }}
          />
        ) : null}
        <span
          className="grid h-full w-full place-items-center"
          style={{ display: avatarSrc ? "none" : "grid" }}
        >
          {initials}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-lg border border-app bg-app-elevated shadow-lg">
          <div className="border-b border-app px-4 py-3">
            <p className="text-sm font-semibold">
              {user ? `${user.firstName} ${user.lastName}` : "Account"}
            </p>
            {user?.email && (
              <p className="truncate text-xs text-app-faint">{user.email}</p>
            )}
          </div>
          {/* Autopilot toggle (used to live in the title bar). */}
          <div className="flex items-center justify-between border-b border-app px-4 py-2.5">
            <span className="text-sm">
              Coworker
              <span className="ml-1 text-xs text-app-faint">
                {autopilot ? "on" : "off"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setAutopilot(!autopilot)}
              className="relative inline-flex h-5 w-9 items-center rounded-full transition"
              style={{
                background: autopilot
                  ? "var(--app-accent)"
                  : "var(--app-border-strong)",
              }}
              aria-pressed={autopilot}
            >
              <span
                className={`absolute h-4 w-4 rounded-full bg-white shadow transition-all ${
                  autopilot ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          {/* Settings opens the modal dialog directly. */}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(
                new CustomEvent("stack62:open-settings"),
              );
            }}
            className="flex w-full items-center gap-2 border-b border-app px-4 py-2.5 text-left text-sm text-app hover:bg-app-hover"
          >
            <SettingsIcon className="h-3.5 w-3.5 text-app-muted" />
            Settings
          </button>
          {/* Compacted menu groups */}
          <ProfileSubmenu label="File" items={fileItems} />
          <ProfileSubmenu label="Export" items={exportItems} />
          <ProfileSubmenu label="View" items={viewItems} />
          <ProfileSubmenu label="Help" items={helpItems} />
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2 border-t border-app px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-app-hover"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One group inside the ProfileMenu — opens a flyout submenu with the
 * underlying MenuItems. Keeps the top-level menu compact.
 */
function ProfileSubmenu({
  label,
  items,
}: {
  label: string;
  items: MenuItem[];
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-app hover:bg-app-hover"
      >
        <span>{label}</span>
        <span className="text-app-faint">›</span>
      </button>
      {hover && items.length > 0 && (
        <div className="absolute right-full top-0 mr-1 w-64 rounded-lg border border-app bg-app-elevated shadow-lg">
          {items.map((item, idx) => (
            <button
              key={`${label}-${idx}`}
              type="button"
              onClick={() => {
                if (!item.disabled) item.onSelect?.();
              }}
              disabled={item.disabled}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                idx > 0 && item.separatorAbove
                  ? "border-t border-app"
                  : ""
              } ${
                item.disabled
                  ? "text-app-faint"
                  : "text-app hover:bg-app-hover"
              }`}
            >
              {item.icon ? <item.icon className="h-3.5 w-3.5" /> : null}
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <kbd className="rounded border border-app px-1 text-[10px] text-app-faint">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
