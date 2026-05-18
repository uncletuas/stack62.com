import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  /** What the user picked: light / dark / system. */
  mode: ThemeMode;
  /** What's currently rendered. If a force override is active (e.g. the
   *  marketing pages forcing dark) this reflects the override; otherwise
   *  it reflects the user's saved preference. */
  resolved: "light" | "dark";
  setMode: (next: ThemeMode) => void;
  toggle: () => void;
  /** Force a theme regardless of the user's saved preference. The
   *  preference is still persisted (so when the override is cleared the
   *  user's choice comes back). Pass `null` to release. Used by the
   *  public/landing shell to lock dark mode without disturbing the
   *  in-app toggle. */
  forceResolved: (next: "light" | "dark" | null) => void;
  /** True when an override is currently active (so UI like the
   *  Appearance picker can hide or disable itself if it likes). */
  isForced: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "stack62.theme";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  // Light by default — cleaner for business teams. Dark stays available
  // as a toggle in Settings > Account.
  return "light";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [userResolved, setUserResolved] = useState<"light" | "dark">(() =>
    resolve(readStoredMode()),
  );
  // Override applied by ForceTheme/PublicShell — takes precedence over
  // the user's saved preference but is NOT persisted to localStorage.
  const [forced, setForced] = useState<"light" | "dark" | null>(null);

  const effective: "light" | "dark" = forced ?? userResolved;

  // Apply the .dark class on <html> so Tailwind's existing `.dark` selector
  // and our --app-* token overrides take effect.
  useEffect(() => {
    const root = document.documentElement;
    if (effective === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    root.dataset.theme = effective;
    root.style.colorScheme = effective;
  }, [effective]);

  // React to system changes when in "system" mode.
  useEffect(() => {
    if (mode !== "system") {
      setUserResolved(mode);
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setUserResolved(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    if (next !== "system") setUserResolved(next);
  }, []);

  const toggle = useCallback(() => {
    setMode(effective === "dark" ? "light" : "dark");
  }, [effective, setMode]);

  const forceResolved = useCallback((next: "light" | "dark" | null) => {
    setForced(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved: effective,
      setMode,
      toggle,
      forceResolved,
      isForced: forced !== null,
    }),
    [mode, effective, setMode, toggle, forceResolved, forced],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider.");
  return ctx;
}
