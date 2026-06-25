import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Loader2,
  RotateCw,
  Search,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  browserAction,
  browserNavigate,
  browserScreenshot,
  browserSearch,
  type BrowserActionInput,
  type BrowserPageState,
  type BrowserSearchResult,
} from "../../lib/api";
import { useWorkspace, type EditorTab } from "../workspace-context";

// DuckDuckGo uses its no-key Instant Answer API server-side, so it returns
// results reliably (search-engine HTML pages serve CAPTCHAs to the server).
// Bing navigates the visible page and may require solving a CAPTCHA by hand.
const ENGINES = [
  { value: "duckduckgo", label: "DuckDuckGo" },
  { value: "bing", label: "Bing (page)" },
];

// Server-side viewport (must match BROWSER_VIEWPORT_* defaults on the backend).
const VIEW_W = 1280;
const VIEW_H = 800;

const POLL_MS = 800;

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return true;
  // bare host like example.com / sub.domain.io/path
  return /^[^\s/]+\.[^\s/]+/.test(v);
}

export function BrowserEditor({ tab }: { tab: EditorTab }) {
  const { updateTab } = useWorkspace();
  const [address, setAddress] = useState(tab.refId ?? "");
  const [engine, setEngine] = useState(ENGINES[0].value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [results, setResults] = useState<BrowserSearchResult[] | null>(null);
  // Until the user navigates somewhere we don't poll screenshots — otherwise
  // we'd show a blank white frame of about:blank and the editor looks broken.
  const [started, setStarted] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const shotUrlRef = useRef<string | null>(null);
  const mounted = useRef(true);

  // Reflect a navigation result into the tab + address bar.
  const applyState = useCallback(
    (state: BrowserPageState) => {
      if (state.url) setAddress(state.url);
      updateTab(tab.id, {
        title: state.title || state.url || "Browser",
        refId: state.url,
      });
    },
    [tab.id, updateTab],
  );

  // ── Screenshot polling ────────────────────────────────────────────
  const refreshShot = useCallback(async (signal?: AbortSignal) => {
    try {
      const blob = await browserScreenshot(signal);
      if (!mounted.current) return;
      const next = URL.createObjectURL(blob);
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
      shotUrlRef.current = next;
      setShotUrl(next);
    } catch {
      /* a transient failure just shows the previous frame */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!started) {
      return () => {
        mounted.current = false;
      };
    }
    const controller = new AbortController();
    const id = window.setInterval(() => {
      void refreshShot(controller.signal);
    }, POLL_MS);
    return () => {
      mounted.current = false;
      controller.abort();
      window.clearInterval(id);
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
      shotUrlRef.current = null;
    };
  }, [refreshShot, started]);

  // ── Navigation + search ───────────────────────────────────────────
  const go = useCallback(
    async (value: string) => {
      const v = value.trim();
      if (!v) return;
      setStarted(true);
      setLoading(true);
      setError(null);
      try {
        if (looksLikeUrl(v)) {
          setResults(null);
          applyState(await browserNavigate(v));
        } else {
          const { results: r, state } = await browserSearch(v, engine);
          setResults(r);
          applyState(state);
        }
        await refreshShot();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load page.");
      } finally {
        setLoading(false);
      }
    },
    [applyState, engine, refreshShot],
  );

  const doAction = useCallback(
    async (action: BrowserActionInput) => {
      setLoading(true);
      try {
        applyState(await browserAction(action));
        await refreshShot();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setLoading(false);
      }
    },
    [applyState, refreshShot],
  );

  // Open the URL passed in via tab.refId on first mount (e.g. coworker
  // opened the browser at a specific page).
  const initialUrl = useMemo(() => tab.refId ?? "", []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialUrl && looksLikeUrl(initialUrl)) {
      void go(initialUrl);
    }
    // Otherwise we stay on the empty state until the user searches/navigates.
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Viewport interaction ──────────────────────────────────────────
  const onViewportClick = useCallback(
    (e: ReactMouseEvent<HTMLImageElement>) => {
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = Math.round(((e.clientX - rect.left) / rect.width) * VIEW_W);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * VIEW_H);
      void doAction({ type: "click", x, y });
    },
    [doAction],
  );

  const onViewportWheel = useCallback(
    (e: ReactWheelEvent<HTMLImageElement>) => {
      void doAction({ type: "scroll", deltaY: Math.round(e.deltaY) });
    },
    [doAction],
  );

  const onViewportKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // Let the address bar and other inputs behave normally.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
      const special = new Set([
        "Enter",
        "Backspace",
        "Tab",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Escape",
        "Home",
        "End",
      ]);
      if (special.has(e.key)) {
        e.preventDefault();
        void doAction({ type: "key", key: e.key });
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void doAction({ type: "type", text: e.key });
      }
    },
    [doAction],
  );

  return (
    <div className="flex h-full flex-col bg-app text-app">
      {/* Toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-app px-3">
        <button
          type="button"
          onClick={() => void doAction({ type: "back" })}
          className="rounded p-1.5 text-app-subtle hover:bg-app-hover hover:text-app"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void doAction({ type: "forward" })}
          className="rounded p-1.5 text-app-subtle hover:bg-app-hover hover:text-app"
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void doAction({ type: "reload" })}
          className="rounded p-1.5 text-app-subtle hover:bg-app-hover hover:text-app"
          title="Reload"
        >
          <RotateCw className="h-4 w-4" />
        </button>

        <div className="relative flex flex-1 items-center">
          <Globe className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-app-subtle" />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void go(address);
            }}
            placeholder="Search DuckDuckGo or enter a URL"
            className="w-full rounded-md border border-app bg-app-subtle py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent"
            spellCheck={false}
          />
        </div>

        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value)}
          className="rounded-md border border-app bg-app-subtle px-2 py-1.5 text-xs outline-none"
          title="Search engine"
        >
          {ENGINES.map((eng) => (
            <option key={eng.value} value={eng.value}>
              {eng.label}
            </option>
          ))}
        </select>

        <Button size="sm" onClick={() => void go(address)} className="gap-1">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Go
        </Button>
      </header>

      {error && (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Search results shortcut bar */}
      {results && results.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-app bg-app-subtle px-3 py-2">
          <ul className="space-y-1">
            {results.slice(0, 8).map((r, i) => (
              <li key={`${r.url}-${i}`}>
                <button
                  type="button"
                  onClick={() => void go(r.url)}
                  className="group flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-app-hover"
                >
                  <span className="flex items-center gap-1 text-xs font-medium text-accent">
                    <ExternalLink className="h-3 w-3" /> {r.title || r.url}
                  </span>
                  {r.snippet && (
                    <span className="line-clamp-1 text-[11px] text-app-subtle">
                      {r.snippet}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Viewport */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-white outline-none"
        tabIndex={0}
        onKeyDown={onViewportKeyDown}
      >
        {shotUrl ? (
          <img
            ref={imgRef}
            src={shotUrl}
            alt="Browser page"
            onClick={onViewportClick}
            onWheel={onViewportWheel}
            draggable={false}
            className="h-full w-full cursor-pointer object-contain object-top"
          />
        ) : (
          <div className="grid h-full place-items-center text-app-subtle">
            <div className="text-center">
              <Globe className="mx-auto mb-3 h-12 w-12 opacity-40" />
              <p className="text-sm">
                {loading ? "Loading…" : "Search or enter a URL to start browsing"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
