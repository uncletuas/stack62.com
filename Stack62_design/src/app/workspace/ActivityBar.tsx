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
    if (activity === key) setSidebarOpen(!sidebarOpen);
    else {
      setActivity(key);
      setSidebarOpen(true);
    }
    // Activities with a dedicated full-pane editor open it as a tab.
    // (Coworker stays in the sidebar / right rail; no editor route.)
    if (key === "files") {
      navigate({ kind: "files-explorer", title: "Files" });
    }
  };

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-app bg-app-surface py-2">
      {TOP.map(({ key, label, icon: Icon }) => {
        const active = activity === key;
        return (
          <button
            key={key}
            title={label}
            onClick={() => click(key)}
            className={`relative mb-0.5 flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition ${
              active
                ? "bg-accent-soft text-accent"
                : "text-app-subtle hover:bg-app-hover hover:text-app"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="leading-none">{label}</span>
          </button>
        );
      })}
      <button
        title="Settings"
        onClick={() => click("settings")}
        className={`mt-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition ${
          activity === "settings"
            ? "bg-accent-soft text-accent"
            : "text-app-subtle hover:bg-app-hover hover:text-app"
        }`}
      >
        <Settings className="h-4 w-4" />
        <span className="leading-none">Settings</span>
      </button>
    </aside>
  );
}
