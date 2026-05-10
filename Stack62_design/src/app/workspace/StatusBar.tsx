import { Cloud, GitBranch, Terminal, Zap } from "lucide-react";
import { useAppContext } from "../context/app-context";
import { useWorkspace } from "./workspace-context";

export function StatusBar() {
  const { currentOrganization, currentWorkspace, user } = useAppContext();
  const { autopilot, runOpen, setRunOpen, tabs, runLog } = useWorkspace();
  const errors = runLog.filter((e) => e.level === "error").length;
  const warns = runLog.filter((e) => e.level === "warn").length;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-cyan-950/70 bg-app px-3 text-[11px] text-app-subtle">
      <span
        className={`flex items-center gap-1 font-medium ${
          autopilot ? "text-emerald-300" : "text-cyan-300"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            autopilot
              ? "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]"
              : "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
          }`}
        />
        coworker {autopilot ? "autopilot" : "standby"}
      </span>
      <span className="flex items-center gap-1">
        <Cloud className="h-3 w-3" />
        {currentOrganization?.name ?? "no org"}
        {currentWorkspace ? ` / ${currentWorkspace.name}` : ""}
      </span>
      <span className="flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        main
      </span>
      <span className="flex items-center gap-1">
        <Zap className="h-3 w-3" />
        {tabs.length} tab{tabs.length === 1 ? "" : "s"}
      </span>
      <button
        onClick={() => setRunOpen(!runOpen)}
        className={`flex items-center gap-1 rounded px-2 py-0.5 hover:bg-white/10 ${
          errors ? "text-rose-300" : warns ? "text-amber-300" : ""
        }`}
      >
        <Terminal className="h-3 w-3" />
        Output
        {errors ? ` · ${errors} err` : warns ? ` · ${warns} warn` : ""}
      </button>
      <span className="ml-auto truncate">{user?.email ?? ""}</span>
    </footer>
  );
}
