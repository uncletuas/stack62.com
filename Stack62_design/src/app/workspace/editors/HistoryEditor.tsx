import { useEffect, useState } from "react";
import { GitBranch, History, Loader2, RotateCcw } from "lucide-react";
import { appDialog } from "../../components/app-dialog";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../context/app-context";
import {
  fetchAiRequests,
  fetchSystem,
  rollbackSystemVersion,
  type AiChangeRequest,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

interface SystemVersion {
  id: string;
  version?: number;
  status?: string;
  appliedAt?: string;
  createdAt?: string;
  summary?: string;
  authorUserId?: string;
  changeRequestId?: string;
  [key: string]: unknown;
}

export function HistoryEditor({ tab }: { tab: EditorTab }) {
  const systemId = tab.refId;
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate, appendRunLog } = useWorkspace();
  const [systemName, setSystemName] = useState("");
  const [versions, setVersions] = useState<SystemVersion[]>([]);
  const [activeVersion, setActiveVersion] = useState<SystemVersion | null>(null);
  const [requests, setRequests] = useState<AiChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    if (!systemId || !currentOrganization) return;
    setLoading(true);
    const [sys, reqs] = await Promise.all([
      fetchSystem(systemId).catch(() => null),
      fetchAiRequests({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        systemId,
      }).catch(() => []),
    ]);
    if (sys) {
      setSystemName(sys.name);
      setVersions(sys.versions as SystemVersion[]);
      setActiveVersion(sys.activeVersion as SystemVersion | null);
    }
    setRequests(reqs);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, currentOrganization?.id, currentWorkspace?.id]);

  const rollback = async (versionId: string) => {
    if (!systemId) return;
    const ok = await appDialog.confirm({
      title: "Roll back this system?",
      description:
        "The schema returns to the selected version. Records aren't deleted.",
      confirmLabel: "Roll back",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(versionId);
    try {
      await rollbackSystemVersion(systemId, versionId);
      appendRunLog({
        level: "ok",
        text: `Rolled back to version ${versionId.slice(0, 8)}`,
        source: "systems",
      });
      await reload();
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Rollback failed: ${(err as Error).message}`,
        source: "systems",
      });
    } finally {
      setBusy(null);
    }
  };

  if (!systemId) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        No system selected.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <History className="h-4 w-4 text-indigo-400" />
        <h1 className="text-sm font-semibold">{systemName || "History"}</h1>
        {loading && (
          <Loader2 className="ml-2 h-4 w-4 animate-spin text-app-faint" />
        )}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <section className="flex min-h-0 flex-col border-r border-app">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Versions
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {versions.length === 0 ? (
              <p className="px-4 py-4 text-xs text-app-faint">No versions.</p>
            ) : (
              versions.map((v) => {
                const id = String(v.id);
                const isActive = activeVersion?.id === v.id;
                return (
                  <div
                    key={id}
                    className={`border-b border-app px-4 py-3 text-xs ${
                      isActive ? "bg-indigo-500/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch
                        className={`h-3.5 w-3.5 ${
                          isActive ? "text-indigo-400" : "text-app-faint"
                        }`}
                      />
                      <span className="font-mono text-app-muted">
                        {id.slice(0, 8)}
                      </span>
                      {v.version !== undefined && (
                        <span className="text-app-faint">v{v.version}</span>
                      )}
                      {isActive && (
                        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[9px] uppercase tracking-wider text-indigo-300">
                          active
                        </span>
                      )}
                      <span className="ml-auto text-app-faint">
                        {v.appliedAt
                          ? new Date(v.appliedAt).toLocaleString()
                          : v.createdAt
                          ? new Date(v.createdAt).toLocaleString()
                          : ""}
                      </span>
                    </div>
                    {v.summary && (
                      <p className="mt-1 text-app-subtle">{v.summary}</p>
                    )}
                    <div className="mt-2 flex gap-2">
                      {!isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === id}
                          onClick={() => void rollback(id)}
                          className="gap-1"
                        >
                          {busy === id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          Roll back
                        </Button>
                      )}
                      {v.changeRequestId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate({
                              kind: "plan",
                              title: v.summary ?? "Plan",
                              refId: String(v.changeRequestId),
                            })
                          }
                        >
                          View plan
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
        <section className="flex min-h-0 flex-col">
          <h2 className="border-b border-app px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-faint">
            Change requests
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {requests.length === 0 ? (
              <p className="px-4 py-4 text-xs text-app-faint">No requests.</p>
            ) : (
              requests.map((r) => (
                <button
                  key={r.id}
                  onClick={() =>
                    navigate({
                      kind: "plan",
                      title: r.summary ?? "Plan",
                      refId: r.id,
                    })
                  }
                  className="flex w-full items-center gap-2 border-b border-app px-4 py-3 text-left text-xs hover:bg-white/5"
                >
                  <GitBranch className="h-3.5 w-3.5 text-amber-400" />
                  <span className="min-w-0 flex-1 truncate">
                    {r.summary ?? r.prompt ?? "(plan)"}
                  </span>
                  <span className="rounded-full border border-app-strong px-2 py-0.5 text-[10px] uppercase text-app-subtle">
                    {r.status}
                  </span>
                  <span className="text-app-faint">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
