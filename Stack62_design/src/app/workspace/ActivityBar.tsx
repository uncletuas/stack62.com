import {
  CalendarDays,
  ClipboardList,
  Database,
  Files,
  FolderTree,
  Layers,
  LineChart,
  MessageSquare,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace, type ActivityKey } from "./workspace-context";

const TOP: Array<{ key: ActivityKey; label: string; icon: LucideIcon }> = [
  { key: "systems", label: "Systems", icon: Layers },
  { key: "explorer", label: "Explorer", icon: Files },
  { key: "files", label: "Files", icon: FolderTree },
  { key: "coworker", label: "Rooms", icon: MessageSquare },
  { key: "records", label: "Records", icon: Database },
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
    if (key === "files") {
      navigate({ kind: "files-explorer", title: "Files" });
    } else if (key === "coworker") {
      navigate({ kind: "room", title: "Rooms" });
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
