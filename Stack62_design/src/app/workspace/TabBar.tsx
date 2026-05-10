import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bot,
  Calendar,
  FileText,
  GitBranch,
  History,
  Home,
  Inbox,
  Layers,
  LayoutTemplate,
  ListTodo,
  Pin,
  PinOff,
  Rocket,
  Settings,
  Share2,
  Sparkles,
  Table,
  Users,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace, type EditorKind, type EditorTab } from "./workspace-context";

const ICON: Record<EditorKind, LucideIcon> = {
  welcome: Home,
  file: FileText,
  document: FileText,
  system: Layers,
  module: Table,
  record: FileText,
  workflow: Workflow,
  schedule: Calendar,
  plan: GitBranch,
  preview: Rocket,
  history: History,
  share: Share2,
  task: Inbox,
  inbox: Inbox,
  templates: LayoutTemplate,
  tools: Wrench,
  teams: Users,
  settings: Settings,
  job: Bot,
  flow: ListTodo,
};

const FULL_TAB_WIDTH = 160;
const PINNED_TAB_WIDTH = 36;
const MIN_TAB_WIDTH = 36;

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    reorderTabs,
    togglePinTab,
    closeOthers,
    closeAll,
  } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [tabWidth, setTabWidth] = useState(FULL_TAB_WIDTH);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tab: EditorTab;
  } | null>(null);

  const recalc = () => {
    const el = containerRef.current;
    if (!el) return;
    const pinnedCount = tabs.filter((t) => t.pinned).length;
    const unpinnedCount = tabs.length - pinnedCount;
    const reserved = pinnedCount * PINNED_TAB_WIDTH;
    const available = el.clientWidth - 4 - reserved;
    const ideal = Math.floor(available / Math.max(1, unpinnedCount || 1));
    setTabWidth(Math.max(MIN_TAB_WIDTH, Math.min(FULL_TAB_WIDTH, ideal)));
  };

  useLayoutEffect(recalc, [tabs.length, tabs.map((t) => t.pinned).join(",")]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(recalc);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  return (
    <>
      <div
        ref={containerRef}
        className="flex h-9 shrink-0 items-end overflow-hidden border-b border-app bg-app-surface pl-1"
      >
        {tabs.map((tab) => {
          const Icon = ICON[tab.kind] ?? Sparkles;
          const active = tab.id === activeTabId;
          const width = tab.pinned ? PINNED_TAB_WIDTH : tabWidth;
          const compact = !tab.pinned && tabWidth < 90;
          const showClose = !tab.pinned && tabWidth >= 60 && tabs.length > 1;
          return (
            <div
              key={tab.id}
              title={tab.title}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("tabId", tab.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const fromId = e.dataTransfer.getData("tabId");
                if (fromId) reorderTabs(fromId, tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, tab });
              }}
              style={{ width, minWidth: MIN_TAB_WIDTH }}
              className={`group flex h-9 shrink-0 items-center gap-1.5 border-r border-app px-2 text-xs ${
                active
                  ? "border-t-2 border-t-indigo-400 bg-app text-white"
                  : "border-t-2 border-t-transparent text-app-subtle hover:bg-slate-800/50 hover:text-app"
              }`}
            >
              <button
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={() => togglePinTab(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {tab.pinned && (
                  <Pin className="h-2.5 w-2.5 shrink-0 text-indigo-400" />
                )}
                {!compact && !tab.pinned && (
                  <span className="min-w-0 flex-1 truncate text-left">
                    {tab.title}
                    {tab.dirty ? " ●" : ""}
                  </span>
                )}
              </button>
              {showClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-white/70 hover:bg-white/15 hover:text-white"
                  aria-label="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-app-strong bg-app-surface py-1 text-xs text-app shadow-2xl"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={menu.tab.pinned ? PinOff : Pin}
            label={menu.tab.pinned ? "Unpin" : "Pin tab"}
            onClick={() => {
              togglePinTab(menu.tab.id);
              setMenu(null);
            }}
          />
          <MenuItem
            icon={X}
            label="Close"
            onClick={() => {
              closeTab(menu.tab.id);
              setMenu(null);
            }}
          />
          <MenuItem
            icon={X}
            label="Close others"
            onClick={() => {
              closeOthers(menu.tab.id);
              setMenu(null);
            }}
          />
          <MenuItem
            icon={X}
            label="Close all"
            onClick={() => {
              closeAll();
              setMenu(null);
            }}
          />
        </div>
      )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10"
    >
      <Icon className="h-3.5 w-3.5 text-app-faint" />
      {label}
    </button>
  );
}
