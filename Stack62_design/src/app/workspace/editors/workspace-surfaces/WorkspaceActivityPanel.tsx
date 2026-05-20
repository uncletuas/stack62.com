import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  ListChecks,
  RefreshCcw,
  Sparkles,
  User as UserIcon,
  X,
} from "lucide-react";
import {
  fetchWorkspaceActionLog,
  type WorkspaceActionLogEntry,
} from "../../../lib/resources";

/**
 * Activity panel — collapsible side panel inside any workspace
 * editor surface. Polls /v1/workspace/docs/:id/actions every few
 * seconds and renders the audit log as a human-readable timeline.
 *
 * Why polling not websocket: the existing Hocuspocus channel ships
 * Yjs updates, not audit-log entries. Adding a second realtime
 * channel just to push log rows isn't worth the complexity — the
 * audit log is a low-frequency view, polling every 3s gives users
 * near-realtime feel without an extra wire protocol.
 *
 * The latest action is also surfaced to the editor header via the
 * `onLatestActor` callback so a "Coworker just edited" badge can
 * react without re-fetching.
 */
export function WorkspaceActivityPanel({
  docId,
  open,
  onClose,
  onLatestActor,
}: {
  docId: string;
  open: boolean;
  onClose: () => void;
  /** Called with the most recent action's actor info each refresh.
   *  Header uses it for the AI-just-edited badge. */
  onLatestActor?: (info: {
    actorKind: "user" | "coworker";
    actorUserId: string;
    occurredAt: string;
  } | null) => void;
}) {
  const [entries, setEntries] = useState<WorkspaceActionLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the callback in a ref so the polling effect doesn't restart
  // every time the parent re-creates the function.
  const onLatestActorRef = useRef(onLatestActor);
  onLatestActorRef.current = onLatestActor;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchWorkspaceActionLog(docId, 80);
      setEntries(rows);
      if (rows[0]) {
        onLatestActorRef.current?.({
          actorKind: rows[0].actorKind,
          actorUserId: rows[0].actorUserId,
          occurredAt: rows[0].occurredAt,
        });
      } else {
        onLatestActorRef.current?.(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [docId]);

  // Poll every 3s. We refresh immediately on mount and whenever the
  // panel opens. When the panel is closed we still poll every 8s
  // because the header's AI badge depends on it (lower frequency
  // when there's no visible UI consuming the data).
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    tick();
    const intervalMs = open ? 3000 : 8000;
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh, open]);

  if (!open) return null;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-app bg-app-surface">
      <header className="flex shrink-0 items-center justify-between border-b border-app px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-app-subtle">
          <ListChecks className="h-3 w-3" /> Activity
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded p-1 text-app-muted hover:bg-app-hover"
            title="Refresh"
          >
            <RefreshCcw
              className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-app-muted hover:bg-app-hover"
            title="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && (
          <p className="px-2 text-[11px] text-rose-300">{error}</p>
        )}
        {entries.length === 0 && !loading && !error && (
          <p className="px-2 py-4 text-center text-[11px] text-app-faint">
            No activity yet. The history grows here as you and your
            Coworker edit.
          </p>
        )}
        <ol className="space-y-1">
          {entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ol>
      </div>
    </aside>
  );
}

// ── Activity row ────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: WorkspaceActionLogEntry }) {
  const ai = entry.actorKind === "coworker";
  const Icon = ai ? Bot : UserIcon;
  return (
    <li
      className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] transition ${
        ai ? "bg-emerald-500/5" : ""
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
          ai
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-app-hover text-app-muted"
        }`}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="font-medium text-app">
            {humanVerb(entry.verb)}
          </span>
          {ai && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1 py-0 text-[9px] uppercase tracking-wide text-emerald-300">
              <Sparkles className="h-2 w-2" /> AI
            </span>
          )}
        </div>
        <div className="text-[10px] text-app-faint">
          {payloadSummary(entry.verb, entry.payload)} ·{" "}
          {timeAgo(entry.occurredAt)}
        </div>
      </div>
    </li>
  );
}

// ── Verb formatting ─────────────────────────────────────────────

const VERB_LABELS: Record<string, string> = {
  "workspace.create_doc": "Created doc",
  "workspace.rename_doc": "Renamed doc",
  "workspace.delete_doc": "Deleted doc",
  "doc.replace_content": "Replaced content",
  "doc.insert_block": "Inserted block",
  "doc.update_block": "Updated block",
  "doc.delete_block": "Deleted block",
  "doc.add_comment": "Added comment",
  "doc.format_range": "Formatted text",
  "sheet.add_sheet": "Added sheet",
  "sheet.delete_sheet": "Deleted sheet",
  "sheet.set_cell": "Edited cell",
  "sheet.set_range": "Edited range",
  "sheet.add_chart": "Added chart",
  "sheet.sort": "Sorted",
  "sheet.filter": "Filtered",
  "slides.add_slide": "Added slide",
  "slides.delete_slide": "Deleted slide",
  "slides.add_element": "Added element",
  "slides.update_element": "Updated element",
  "slides.move_element": "Moved element",
  "slides.delete_element": "Deleted element",
  "slides.apply_theme": "Applied theme",
};

function humanVerb(verb: string): string {
  return VERB_LABELS[verb] ?? verb;
}

function payloadSummary(
  verb: string,
  payload: Record<string, unknown>,
): string {
  if (verb === "workspace.create_doc") {
    return String(payload.title ?? payload.kind ?? "");
  }
  if (verb === "workspace.rename_doc") {
    return `→ ${payload.title ?? ""}`;
  }
  if (verb === "sheet.set_cell") {
    const ref = `${colLabel(Number(payload.col ?? 0))}${Number(payload.row ?? 0) + 1}`;
    const val =
      payload.formula != null
        ? `=${payload.formula}`
        : payload.value != null
          ? String(payload.value).slice(0, 24)
          : "(empty)";
    return `${ref} = ${val}`;
  }
  if (verb === "sheet.set_range") {
    return `range from ${colLabel(Number(payload.fromCol ?? 0))}${Number(payload.fromRow ?? 0) + 1}`;
  }
  if (verb === "slides.add_element") {
    const el = (payload.element as { type?: string } | undefined) ?? {};
    return `${el.type ?? "element"}`;
  }
  if (verb === "slides.move_element" || verb === "slides.update_element") {
    return `element ${String(payload.elementId ?? "").slice(0, 8)}`;
  }
  if (verb === "doc.insert_block") {
    const block = (payload.block as { type?: string } | undefined) ?? {};
    return `${block.type ?? "block"}`;
  }
  return "";
}

function colLabel(col: number): string {
  let s = "";
  let n = col;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

void ChevronRight; // reserved for an expand-payload affordance
