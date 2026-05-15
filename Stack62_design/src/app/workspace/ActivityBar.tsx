import {
  CalendarDays,
  ClipboardList,
  Files,
  Layers,
  LineChart,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace, type ActivityKey } from "./workspace-context";

// Trimmed: Records and Explorer removed (duplicated Files); the Rooms
// entry folded into Coworker — chat surface now has Coworker/Team/Rooms
// tabs internally so it's one click instead of two top-level destinations.
// Coworker isn't a top-level activity — the floating CoworkerRail
// (right side, always reachable) is the chat surface. Putting it here
// duplicated the same destination twice in different places.
const TOP: Array<{ key: ActivityKey; label: string; icon: LucideIcon }> = [
  { key: "systems", label: "Systems", icon: Layers },
  { key: "files", label: "Files", icon: Files },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "schedules", label: "Schedules", icon: CalendarDays },
  { key: "reports", label: "Reports", icon: LineChart },
];

export function ActivityBar() {
  const { activity, setActivity, sidebarOpen, setSidebarOpen, navigate } =
    useWorkspace();

  const click = (key: ActivityKey) => {
    // Files opens its grid editor directly — no sidebar duplication
    // of the same filter chips. Force the sidebar closed on entry so
    // the grid gets the full canvas. Other activities keep the
    // sidebar toggle.
    if (key === "files") {
      setActivity(key);
      setSidebarOpen(false);
      navigate({ kind: "files-explorer", title: "Files" });
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
        return (
          <button
            key={key}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={() => click(key)}
            className={`relative mb-0.5 flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-12 sm:w-12 ${
              active
                ? "bg-accent-soft text-accent"
                : "text-app-subtle hover:bg-app-hover hover:text-app"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {/* Labels hidden on very small screens to keep the rail compact. */}
            <span className="hidden leading-none sm:inline">{label}</span>
          </button>
        );
      })}
      <button
        title="Settings"
        aria-label="Settings"
        onClick={openSettings}
        className="mt-auto flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-app-subtle hover:bg-app-hover hover:text-app sm:h-12 sm:w-12"
      >
        <Settings className="h-4 w-4" aria-hidden />
        <span className="hidden leading-none sm:inline">Settings</span>
      </button>
    </aside>
  );
}
