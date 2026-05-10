import { useEffect } from "react";
import { useWorkspace } from "./workspace-context";

export function useGlobalShortcuts() {
  const {
    setPaletteOpen,
    setSidebarOpen,
    sidebarOpen,
    setRunOpen,
    runOpen,
    activeTabId,
    closeTab,
    tabs,
    setActiveTab,
    setActivity,
    back,
    forward,
  } = useWorkspace();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setRunOpen(!runOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === "w") {
        if (activeTabId) {
          e.preventDefault();
          closeTab(activeTabId);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "t" && !inField) {
        e.preventDefault();
        setActivity("coworker");
        setSidebarOpen(true);
        return;
      }
      if (mod && e.key === "Tab") {
        e.preventDefault();
        if (tabs.length === 0) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const nextIdx = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        setActiveTab(tabs[nextIdx].id);
        return;
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1;
        if (tabs[n]) {
          e.preventDefault();
          setActiveTab(tabs[n].id);
        }
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (inField) return;
        e.preventDefault();
        if (e.key === "ArrowLeft") back();
        else forward();
        return;
      }
      if (mod && e.altKey && !inField) {
        const map: Record<
          string,
          | "explorer"
          | "flow"
          | "systems"
          | "tools"
          | "teams"
        > = {
          f: "flow",
          e: "explorer",
          s: "systems",
          o: "tools",
          m: "teams",
        };
        const target = map[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          setActivity(target);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    setPaletteOpen,
    setSidebarOpen,
    sidebarOpen,
    setRunOpen,
    runOpen,
    activeTabId,
    closeTab,
    tabs,
    setActiveTab,
    setActivity,
    back,
    forward,
  ]);
}
