import {
  Bell,
  CalendarDays,
  Files,
  Home,
  LineChart,
  Settings,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace, type ActivityKey } from "./workspace-context";

const TOP: Array<{ key: ActivityKey; label: string; icon: LucideIcon }> = [
  { key: "home",      label: "Home",       icon: Home },
  { key: "decisions", label: "Decisions",  icon: Bell },
  { key: "systems",   label: "Operations", icon: Zap },
  { key: "tasks",     label: "Tasks",      icon: CalendarDays },
  { key: "reports",   label: "Reports",    icon: LineChart },
  { key: "files",     label: "Files",      icon: Files },
  { key: "teams",     label: "Team",       icon: Users },
];

export function ActivityBar({
  decisionCount = 0,
}: {
  decisionCount?: number;
}) {
  const { activity, setActivity, sidebarOpen, setSidebarOpen, navigate } =
    useWorkspace();

  const click = (key: ActivityKey) => {
    if (key === "files") {
      setActivity(key);
      setSidebarOpen(false);
      navigate({ kind: "files-explorer", title: "Files" });
      return;
    }
    if (key === "home") {
      setActivity(key);
      setSidebarOpen(false);
      navigate({ kind: "welcome", title: "Home" });
      return;
    }
    if (activity === key) setSidebarOpen(!sidebarOpen);
    else {
      setActivity(key);
      setSidebarOpen(true);
    }
  };

  const openSettings = () =>
    window.dispatchEvent(new CustomEvent("stack62:open-settings"));

  return (
    <aside
      role="navigation"
      aria-label="Primary"
      className="flex w-12 shrink-0 flex-col items-center border-r border-app bg-app-surface py-2 sm:w-14"
    >
      {TOP.map(({ key, label, icon: Icon }) => {
        const active = activity === key;
        const showBadge = key === "decisions" && decisionCount > 0;
        return (
          <button
            key={key}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => click(key)}
            className={`relative mb-0.5 flex h-11 w-11 items-center justify-center rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-12 sm:w-12 ${
              active
                ? "bg-accent-soft text-accent"
                : "text-app-subtle hover:bg-app-hover hover:text-app"
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {showBadge && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white">
                  {decisionCount > 9 ? "9+" : decisionCount}
                </span>
              )}
            </span>
          </button>
        );
      })}
      <button
        title="Settings"
        aria-label="Settings"
        onClick={openSettings}
        className="mt-auto flex h-11 w-11 items-center justify-center rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-app-subtle hover:bg-app-hover hover:text-app sm:h-12 sm:w-12"
      >
        <Settings className="h-5 w-5" aria-hidden />
      </button>
    </aside>
  );
}
