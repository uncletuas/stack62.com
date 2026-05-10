import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Rocket,
  Square,
  Terminal,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  buildPreviewUrl,
  createPreviewSession,
  createRunnerEventSource,
  deploySystem,
  fetchDeploymentLogs,
  fetchDeployments,
  fetchSystem,
  startDeployment,
  stopDeployment,
  type DeploymentPreviewSession,
  type DeploymentStatus,
  type RunnerEvent,
  type SystemDeployment,
} from "../../lib/resources";
import { useAppContext } from "../../context/app-context";
import { useWorkspace, type EditorTab } from "../workspace-context";

const STATUS_COLOR: Record<DeploymentStatus, string> = {
  pending: "bg-slate-700 text-app-muted",
  building: "bg-amber-500/20 text-amber-200",
  starting: "bg-amber-500/20 text-amber-200",
  running: "bg-emerald-500/20 text-emerald-200",
  stopped: "bg-slate-700 text-app-muted",
  crashed: "bg-rose-500/20 text-rose-200",
};

export function PreviewEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, setRunOpen } = useWorkspace();
  const systemId = tab.refId;
  const [systemName, setSystemName] = useState("");
  const [deployments, setDeployments] = useState<SystemDeployment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<"deploy" | "start" | "stop" | null>(null);
  const [session, setSession] = useState<DeploymentPreviewSession | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const active = deployments.find((d) => d.id === activeId) ?? deployments[0] ?? null;

  const reload = async () => {
    if (!systemId) return;
    const [list, sysDetail] = await Promise.all([
      fetchDeployments(systemId).catch(() => [] as SystemDeployment[]),
      fetchSystem(systemId).catch(() => null),
    ]);
    if (sysDetail) setSystemName(sysDetail.name);
    setDeployments(list);
    setActiveId((cur) => cur ?? list[0]?.id ?? null);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  useEffect(() => {
    if (!systemId) return;
    const es = createRunnerEventSource(systemId);
    eventSourceRef.current = es;
    es.addEventListener("message", (e) => {
      try {
        const data: RunnerEvent = JSON.parse(e.data);
        setLogs((cur) =>
          [
            ...cur,
            `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.phase}/${data.level}: ${data.message}${data.detail ? ` — ${data.detail}` : ""}`,
          ].slice(-500),
        );
        if (data.phase === "status" || data.phase === "deployment") {
          void reload();
        }
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      /* keep alive */
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  useEffect(() => {
    if (!active) return setSession(null);
    if (active.status !== "running") return setSession(null);
    let live = true;
    void createPreviewSession(active.id)
      .then((s) => live && setSession(s))
      .catch(() => live && setSession(null));
    return () => {
      live = false;
    };
  }, [active?.id, active?.status]);

  useEffect(() => {
    if (!active?.id) return;
    let live = true;
    void fetchDeploymentLogs(active.id, 200)
      .then((res) => {
        if (live) setLogs(res.lines.slice(-500));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [active?.id]);

  if (!systemId) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        No system selected.
      </div>
    );
  }

  const deploy = async () => {
    if (!currentOrganization || !systemId) return;
    setBusy("deploy");
    setRunOpen(true);
    appendRunLog({ level: "info", text: "Deploying…", source: "runner" });
    try {
      const dep = await deploySystem({
        systemId,
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      });
      setDeployments((cur) => [dep, ...cur.filter((d) => d.id !== dep.id)]);
      setActiveId(dep.id);
      appendRunLog({
        level: "ok",
        text: `Deployment ${dep.id.slice(0, 8)} ${dep.status}`,
        source: "runner",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Deploy failed: ${(err as Error).message}`,
        source: "runner",
      });
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!active) return;
    setBusy("start");
    try {
      const dep = await startDeployment(active.id);
      setDeployments((cur) => cur.map((d) => (d.id === dep.id ? dep : d)));
      appendRunLog({
        level: "ok",
        text: `Started ${dep.id.slice(0, 8)}`,
        source: "runner",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Start failed: ${(err as Error).message}`,
        source: "runner",
      });
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!active) return;
    setBusy("stop");
    try {
      const dep = await stopDeployment(active.id);
      setDeployments((cur) => cur.map((d) => (d.id === dep.id ? dep : d)));
      appendRunLog({
        level: "ok",
        text: `Stopped ${dep.id.slice(0, 8)}`,
        source: "runner",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Stop failed: ${(err as Error).message}`,
        source: "runner",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Rocket className="h-4 w-4 text-indigo-400" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {systemName || "Preview"}
          </h1>
          <p className="text-[11px] text-app-faint">
            {active
              ? `${active.runtime} · ${active.entrypoint}${active.port ? ` · :${active.port}` : ""}`
              : "No deployment"}
          </p>
        </div>
        {active && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_COLOR[active.status]}`}
          >
            {active.status}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {deployments.length > 1 && (
            <select
              value={active?.id ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
              className="rounded border border-app bg-app-surface px-2 py-1 text-xs"
            >
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id.slice(0, 8)} · {d.status}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            onClick={() => void deploy()}
            disabled={busy === "deploy"}
            className="gap-1"
          >
            {busy === "deploy" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Deploy
          </Button>
          {active && active.status !== "running" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void start()}
              disabled={busy === "start"}
              className="gap-1"
            >
              {busy === "start" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Start
            </Button>
          )}
          {active && ["running", "starting", "building", "pending"].includes(active.status) && (
            <>
              {active.status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPreviewKey((k) => k + 1)}
                  className="gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reload
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void stop()}
                disabled={busy === "stop"}
                className="gap-1"
              >
                {busy === "stop" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                Stop
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_220px]">
        <div className="min-h-0 overflow-hidden bg-app-surface">
          {!active ? (
            <div className="grid h-full place-items-center text-sm text-app-faint">
              <div className="text-center">
                <Power className="mx-auto h-8 w-8 text-slate-700" />
                <p className="mt-3">No deployments. Click Deploy.</p>
              </div>
            </div>
          ) : active.status !== "running" || !session ? (
            <div className="grid h-full place-items-center text-sm text-app-faint">
              {active.status === "crashed" ? (
                <div className="text-center">
                  <p className="text-rose-300">Crashed</p>
                  {active.errorMessage && (
                    <pre className="mt-2 max-w-2xl whitespace-pre-wrap text-xs text-app-subtle">
                      {active.errorMessage}
                    </pre>
                  )}
                </div>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-app bg-app px-3 text-[11px] text-app-faint">
                <span className="font-mono">{buildPreviewUrl(session)}</span>
                <a
                  href={buildPreviewUrl(session)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto flex items-center gap-1 hover:text-app"
                >
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              </div>
              <iframe
                key={previewKey}
                src={buildPreviewUrl(session)}
                title="Preview"
                className="min-h-0 flex-1 bg-white"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col border-t border-app bg-app">
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-app px-3 text-[11px] text-app-faint">
            <Terminal className="h-3 w-3" />
            <span>Logs · {logs.length}</span>
            <button
              onClick={() => setLogs([])}
              className="ml-auto hover:text-app"
            >
              clear
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] text-emerald-200">
            {logs.length === 0 ? (
              <span className="text-app-faint">No logs yet.</span>
            ) : (
              logs.join("\n")
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
