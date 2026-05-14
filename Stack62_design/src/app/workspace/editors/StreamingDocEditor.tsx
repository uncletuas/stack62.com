import { useCallback, useRef, useState } from "react";
import { Sparkles, Square } from "lucide-react";
import {
  streamGeneration,
  type StreamGenerationEvent,
} from "../../lib/dms-resources";
import { useAppContext } from "../../context/app-context";

type OutputKind = "text" | "markdown" | "csv" | "json" | "code";

/**
 * The streaming editor.
 *
 * The user types a prompt, picks an output kind, and we open an SSE
 * stream against /streaming-generation. Each `delta` event appends to
 * the editor in real-time, simulating the AI typing the document into
 * the page. Mid-stream they can cancel and rewrite.
 *
 * This is the surface the Coworker uses when asked to draft documents,
 * spreadsheets, etc. — the typing animation makes the "AI is doing work"
 * visible instead of having a wait-and-then-paste UX.
 */
export function StreamingDocEditor() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const orgId = currentOrganization?.id ?? "";

  const [prompt, setPrompt] = useState("");
  const [outputKind, setOutputKind] = useState<OutputKind>("markdown");
  const [content, setContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    if (!prompt.trim() || !orgId) return;
    setError(null);
    setContent("");
    setTokens(0);
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await streamGeneration({
        organizationId: orgId,
        workspaceId: currentWorkspace?.id,
        prompt: prompt.trim(),
        outputKind,
        signal: abort.signal,
        onEvent: (event: StreamGenerationEvent) => {
          if (event.type === "delta") {
            setContent((prev) => prev + event.text);
          } else if (event.type === "completed") {
            setTokens(event.tokens);
          } else if (event.type === "error") {
            setError(event.message);
          }
        },
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [prompt, orgId, currentWorkspace?.id, outputKind]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-app px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">
              Coworker live document
            </h2>
            <div className="flex-1" />
            <select
              value={outputKind}
              onChange={(e) => setOutputKind(e.target.value as OutputKind)}
              disabled={streaming}
              className="rounded-md border border-app bg-app px-2 py-1 text-xs"
            >
              <option value="markdown">Markdown</option>
              <option value="text">Plain text</option>
              <option value="csv">CSV / table</option>
              <option value="json">JSON</option>
              <option value="code">Code</option>
            </select>
          </div>
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "Draft a 200-word onboarding email for new sales hires"'
              rows={2}
              disabled={streaming}
              className="min-h-9 flex-1 resize-none rounded-md border border-app bg-app px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/5 px-3 text-sm text-red-500 hover:bg-red-500/10"
              >
                <Square className="size-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={start}
                disabled={!prompt.trim()}
                className="flex items-center gap-1.5 rounded-md bg-accent px-3 text-sm text-accent-fg hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="size-4" />
                Generate
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-app">
        {content || streaming ? (
          <pre className="whitespace-pre-wrap break-words p-6 font-mono text-sm leading-relaxed">
            {content}
            {streaming && (
              <span className="inline-block h-4 w-2 animate-pulse bg-accent align-middle" />
            )}
          </pre>
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-app-faint">
            <div className="max-w-md">
              <Sparkles className="mx-auto mb-2 size-6 text-app-faint" />
              <p>Ask the Coworker to draft a document.</p>
              <p className="mt-1 text-xs">
                It types in real time. Cancel and re-prompt mid-stream if
                you want a different angle.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-app px-4 py-2 text-xs text-app-faint">
        <span>
          {streaming
            ? "Generating…"
            : tokens > 0
              ? `Done — ~${tokens} tokens`
              : ""}
        </span>
        {error && (
          <span className="text-red-500">Error: {error}</span>
        )}
      </div>
    </div>
  );
}
