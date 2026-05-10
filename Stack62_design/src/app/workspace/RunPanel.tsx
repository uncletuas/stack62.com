import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  Trash2,
  XCircle,
} from "lucide-react";
import { useWorkspace, type RunLogEntry } from "./workspace-context";

const ICON = {
  info: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
} as const;

const COLOR = {
  info: "text-app-muted",
  ok: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-rose-300",
} as const;

export function RunPanel() {
  const { runOpen, setRunOpen, runLog, clearRunLog } = useWorkspace();
  if (!runOpen) return null;

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-app bg-app">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-app px-3 text-xs">
        <div className="flex gap-4">
          <span className="font-semibold text-white">Output</span>
          <span className="text-app-faint">{runLog.length} entries</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearRunLog}
            className="grid h-6 w-6 place-items-center rounded text-app-faint hover:bg-white/10 hover:text-app"
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setRunOpen(false)}
            className="grid h-6 w-6 place-items-center rounded text-app-faint hover:bg-white/10 hover:text-app"
            title="Hide panel"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
        {runLog.length === 0 ? (
          <p className="text-app-faint">No output yet.</p>
        ) : (
          runLog.map((entry) => <LogLine key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: RunLogEntry }) {
  const Icon = ICON[entry.level];
  const time = new Date(entry.ts).toLocaleTimeString();
  return (
    <div className={`flex items-start gap-2 py-0.5 ${COLOR[entry.level]}`}>
      <Icon className="mt-[2px] h-3 w-3 shrink-0 opacity-80" />
      <span className="w-16 shrink-0 text-[10px] text-app-faint">{time}</span>
      {entry.source && (
        <span className="w-12 shrink-0 truncate text-[10px] text-app-faint">
          {entry.source}
        </span>
      )}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {entry.text}
      </span>
    </div>
  );
}
