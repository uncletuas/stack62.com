import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "../context/theme-context";
import { useAppContext } from "../context/app-context";
import { useAdminAuth } from "./useAdminAuth";
import { NAV_GROUPS, MODULE_LABELS } from "./nav";
import { MODULE_COMPONENTS } from "./modules";
import { getActivity, type ActivityEvent, type AdminModuleKey } from "./lib/admin-api";
import { relTime } from "./components";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  finance_manager: "Finance Manager",
  support_manager: "Support Manager",
  engineer: "Engineer",
  security_officer: "Security Officer",
  operations_manager: "Operations Manager",
  executive: "Executive",
};

export function AssemblyShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, can } = useAdminAuth();
  const { resolved, toggle } = useTheme();
  const { logout } = useAppContext();

  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const active = (location.pathname.replace(/^\/assembly\/?/, "").split("/")[0] ||
    "dashboard") as AdminModuleKey;

  // Default to dashboard if the URL is bare /assembly.
  useEffect(() => {
    if (location.pathname === "/assembly" || location.pathname === "/assembly/") {
      navigate("/assembly/dashboard", { replace: true });
    }
  }, [location.pathname, navigate]);

  // ⌘K / Ctrl-K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => can(i.key)),
      })).filter((g) => g.items.length > 0),
    [can],
  );

  const ActiveComponent = MODULE_COMPONENTS[active] ?? MODULE_COMPONENTS.dashboard;
  const allowed = can(active);

  return (
    <div className="flex h-screen overflow-hidden bg-app text-app">
      {/* Left nav */}
      <aside
        className={`flex shrink-0 flex-col border-r border-app bg-app-surface transition-all ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-app px-3">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-accent-fg text-sm font-bold">
            S
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Assembly</div>
              <div className="truncate text-[10px] text-app-faint">
                Stack62 Admin
              </div>
            </div>
          )}
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-app-faint">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ key, label, icon: Icon }) => {
                  const isActive = active === key;
                  return (
                    <button
                      key={key}
                      title={label}
                      onClick={() => navigate(`/assembly/${key}`)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
                        isActive
                          ? "bg-accent text-accent-fg font-medium"
                          : "text-app-muted hover:bg-app-hover hover:text-app"
                      } ${collapsed ? "justify-center" : ""}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-10 items-center justify-center border-t border-app text-app-faint hover:bg-app-hover hover:text-app"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top command bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-app bg-app-surface px-4">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-lg border border-app bg-app px-3 text-sm text-app-faint hover:border-app-strong"
          >
            <Search className="h-4 w-4" />
            <span>Search modules…</span>
            <kbd className="ml-auto rounded border border-app px-1.5 text-[10px]">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setNotifOpen((o) => !o)}
              title="Notifications"
              className="grid h-9 w-9 place-items-center rounded-md text-app-muted hover:bg-app-hover hover:text-app"
            >
              <Bell className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={toggle}
              title="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-md text-app-muted hover:bg-app-hover hover:text-app"
            >
              {resolved === "dark" ? (
                <Sun className="h-4.5 w-4.5" />
              ) : (
                <Moon className="h-4.5 w-4.5" />
              )}
            </button>
            <div className="mx-1 flex items-center gap-2 rounded-md border border-app px-2 py-1">
              <div className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                {(me?.firstName?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-medium leading-none">
                  {me?.firstName} {me?.lastName}
                </div>
                <div className="text-[10px] text-app-faint">
                  {ROLE_LABELS[me?.platformRole ?? ""] ?? me?.platformRole}
                </div>
              </div>
            </div>
            <button
              onClick={() => logout()}
              title="Sign out"
              className="grid h-9 w-9 place-items-center rounded-md text-app-muted hover:bg-app-hover hover:text-app"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {allowed ? (
            <ActiveComponent />
          ) : (
            <div className="p-12 text-center text-sm text-app-muted">
              Your role doesn't have access to{" "}
              <span className="font-medium text-app">
                {MODULE_LABELS[active] ?? active}
              </span>
              .
            </div>
          )}
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onPick={(key) => {
            setPaletteOpen(false);
            navigate(`/assembly/${key}`);
          }}
          allowed={(key) => can(key)}
        />
      )}
      {notifOpen && <NotificationDrawer onClose={() => setNotifOpen(false)} />}
    </div>
  );
}

function CommandPalette({
  onClose,
  onPick,
  allowed,
}: {
  onClose: () => void;
  onPick: (key: AdminModuleKey) => void;
  allowed: (key: AdminModuleKey) => boolean;
}) {
  const [query, setQuery] = useState("");
  const items = NAV_GROUPS.flatMap((g) => g.items).filter(
    (i) =>
      allowed(i.key) && i.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-app bg-app-elevated shadow-doc"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-app px-3">
          <Search className="h-4 w-4 text-app-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a module…"
            className="h-11 flex-1 bg-transparent text-sm text-app outline-none placeholder:text-app-faint"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-app-faint">
              No matches.
            </div>
          ) : (
            items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => onPick(key)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-app-muted hover:bg-app-hover hover:text-app"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationDrawer({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    getActivity(40)
      .then((e) => live && setEvents(e))
      .catch(() => live && setEvents([]));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-80 flex-col border-l border-app bg-app-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center justify-between border-b border-app px-4">
          <h3 className="text-sm font-semibold">Activity</h3>
          <button onClick={onClose} className="text-app-faint hover:text-app">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {events === null ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md border border-app bg-app-hover"
                />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="p-6 text-center text-sm text-app-faint">
              No recent activity.
            </div>
          ) : (
            events.map((e) => (
              <div key={e.id} className="border-b border-app-soft px-4 py-2.5">
                <div className="text-sm text-app">{e.action.replace(/\./g, " ")}</div>
                <div className="text-[11px] text-app-faint">
                  {e.targetType} · {relTime(e.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
