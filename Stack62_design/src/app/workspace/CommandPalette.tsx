import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  Globe,
  Layers,
  ListTodo,
  Mail,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppContext } from "../context/app-context";
import {
  fetchSchedules,
  fetchSystems,
  searchWorkspace,
  type Schedule,
  type SystemSummary,
  type WorkspaceSearchResult,
} from "../lib/resources";
import { useWorkspace, type EditorKind } from "./workspace-context";

interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, navigate, setActivity } = useWorkspace();
  const { currentOrganization, currentWorkspace } = useAppContext();
  const [query, setQuery] = useState("");
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [searchResult, setSearchResult] = useState<WorkspaceSearchResult | null>(
    null,
  );

  useEffect(() => {
    if (!paletteOpen || !currentOrganization) return;
    void Promise.all([
      fetchSystems({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchSchedules({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
    ]).then(([s, sc]) => {
      setSystems(s);
      setSchedules(sc);
    });
  }, [paletteOpen, currentOrganization, currentWorkspace?.id]);

  useEffect(() => {
    if (!paletteOpen || !currentOrganization || query.trim().length < 2) {
      setSearchResult(null);
      return;
    }
    let live = true;
    const handle = window.setTimeout(() => {
      void searchWorkspace({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        q: query.trim(),
      })
        .then((result) => live && setSearchResult(result))
        .catch(() => live && setSearchResult(null));
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(handle);
    };
  }, [paletteOpen, query, currentOrganization, currentWorkspace?.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setPaletteOpen]);

  const commands: PaletteCommand[] = useMemo(() => {
    const open = (kind: EditorKind, title: string, refId?: string) => () => {
      navigate({ kind, title, refId });
      setPaletteOpen(false);
    };
    const items: PaletteCommand[] = [
      {
        id: "go:flow",
        label: "Open Flow",
        hint: "Workspace activity handled by the coworker",
        group: "Action",
        icon: ListTodo,
        run: () => {
          setActivity("flow");
          setPaletteOpen(false);
        },
      },
      {
        id: "create:streaming-doc",
        label: "Generate document with AI",
        hint: "Watch the Coworker type a doc / spreadsheet / code in real time",
        group: "Action",
        icon: Sparkles,
        run: open("streaming-doc", "Generate document"),
      },
      {
        id: "open:browser",
        label: "Open web browser",
        hint: "Browse the web; the coworker can search, open and read pages",
        group: "Action",
        icon: Globe,
        run: open("browser", "Browser"),
      },
      {
        id: "create:email",
        label: "New email",
        hint: "Compose and send via your connected email account",
        group: "Action",
        icon: Mail,
        run: () => {
          window.dispatchEvent(new CustomEvent("stack62:open-email"));
          setPaletteOpen(false);
        },
      },
      {
        id: "go:email-inbox",
        label: "Email inbox",
        hint: "See incoming email from your connected mailbox",
        group: "Go",
        icon: Mail,
        run: () => {
          window.dispatchEvent(new CustomEvent("stack62:open-email-inbox"));
          setPaletteOpen(false);
        },
      },
      {
        id: "go:settings",
        label: "Settings",
        group: "Go",
        icon: Settings,
        run: () => {
          window.dispatchEvent(new CustomEvent("stack62:open-settings"));
          setPaletteOpen(false);
        },
      },
    ];

    for (const s of systems.slice(0, 8)) {
      items.push({
        id: `sys:${s.id}`,
        label: s.name,
        hint: s.purpose ?? s.industryType ?? undefined,
        group: "Systems",
        icon: Layers,
        run: open("system", s.name, s.id),
      });
    }
    for (const s of schedules.slice(0, 8)) {
      items.push({
        id: `sch:${s.id}`,
        label: s.title,
        group: "Schedules",
        icon: Calendar,
        run: open("schedule", s.title, s.id),
      });
    }
    if (searchResult) {
      const add = (
        id: string,
        label: string,
        group: string,
        kind: EditorKind,
        icon: LucideIcon,
        hint?: string,
      ) => {
        items.push({
          id,
          label,
          hint,
          group,
          icon,
          run: open(kind, label, id.split(":").slice(1).join(":")),
        });
      };
      for (const item of searchResult.systems.slice(0, 5))
        add(`system:${item.id}`, item.title, "Workspace", "system", Layers);
      for (const item of searchResult.documents.slice(0, 5))
        add(`document:${item.id}`, item.title, "Workspace", "document", FileText);
      for (const item of searchResult.files.slice(0, 5))
        add(`file:${item.id}`, item.title, "Workspace", "file", FileText);
      for (const item of searchResult.records.slice(0, 5))
        add(`record:${item.id}`, item.title, "Workspace", "record", Database);
      for (const item of searchResult.tasks.slice(0, 5))
        add(`task:${item.id}`, item.title, "Workspace", "task", CheckCircle2);
      for (const item of searchResult.schedules.slice(0, 5))
        add(`schedule:${item.id}`, item.title, "Workspace", "schedule", Calendar);
      for (const item of searchResult.chunks.slice(0, 5))
        add(
          `chunk:${item.sourceId}`,
          item.sourceTitle,
          "Content",
          item.sourceType,
          FileText,
          item.content.slice(0, 80),
        );
    }
    return items;
  }, [systems, schedules, searchResult, navigate, setActivity, setPaletteOpen]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        (c.hint ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  if (!paletteOpen) return null;

  const grouped = filtered.reduce<Record<string, PaletteCommand[]>>(
    (acc, cur) => {
      (acc[cur.group] ??= []).push(cur);
      return acc;
    },
    {},
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24 backdrop-blur-sm"
      onClick={() => setPaletteOpen(false)}
    >
      <div
        className="w-[640px] max-w-[92vw] overflow-hidden rounded-xl border border-app-strong bg-app-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-app px-3 py-2">
          <Plus className="h-4 w-4 text-app-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspace or run a command..."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-app-faint"
          />
          <kbd className="rounded border border-app-strong px-1.5 py-0.5 text-[10px] text-app-subtle">
            Esc
          </kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto py-1">
          {Object.entries(grouped).map(([group, list]) => (
            <div key={group} className="py-1">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-app-faint">
                {group}
              </div>
              {list.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onClick={c.run}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-app hover:bg-white/5"
                  >
                    <Icon className="h-4 w-4 text-app-faint" />
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && (
                      <span className="ml-2 truncate text-xs text-app-faint">
                        {c.hint}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-app-faint">
              No matches.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
