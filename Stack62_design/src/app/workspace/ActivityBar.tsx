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
    <aside className="flex w-12 shrink-0 flex-col items-center border-r border-cyan-950/70 bg-app py-2 shadow-[inset_-1px_0_0_rgba(34,211,238,0.06)]">
      {TOP.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          title={label}
          onClick={() => click(key)}
          className={`group relative mb-1 grid h-10 w-10 place-items-center rounded-xl transition ${
            activity === key
              ? "text-white"
              : "text-app-faint hover:bg-cyan-300/10 hover:text-cyan-100"
          }`}
        >
          <Icon className="h-5 w-5" />
        </button>
      ))}
      <button
        title="Settings"
        onClick={() => click("settings")}
        className={`mt-auto grid h-10 w-10 place-items-center rounded-xl transition ${
          activity === "settings"
            ? "text-white"
            : "text-app-faint hover:bg-cyan-300/10 hover:text-cyan-100"
        }`}
      >
        <Settings className="h-5 w-5" />
      </button>
    </aside>
  );
}
