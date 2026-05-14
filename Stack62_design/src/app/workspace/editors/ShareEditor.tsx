import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Share2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import {
  createSharePackage,
  fetchSharePackages,
  fetchSystem,
  type SharePackage,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

const MODES: Array<{
  value: "template_only" | "cloned_instance" | "live_shared_workspace";
  label: string;
}> = [
  { value: "template_only", label: "Template (read-only schema)" },
  { value: "cloned_instance", label: "Cloned instance" },
  { value: "live_shared_workspace", label: "Live shared workspace" },
];

const DATA_MODES: Array<{
  value: "include_data" | "masked_data" | "exclude_data";
  label: string;
}> = [
  { value: "exclude_data", label: "Exclude data" },
  { value: "masked_data", label: "Masked data" },
  { value: "include_data", label: "Include data" },
];

const ACCESS_MODES: Array<{ value: "view" | "use" | "edit"; label: string }> = [
  { value: "view", label: "View only" },
  { value: "use", label: "Use" },
  { value: "edit", label: "Edit" },
];

export function ShareEditor({ tab }: { tab: EditorTab }) {
  const systemId = tab.refId;
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [systemName, setSystemName] = useState("");
  const [packages, setPackages] = useState<SharePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    mode: "live_shared_workspace" as
      | "template_only"
      | "cloned_instance"
      | "live_shared_workspace",
    dataAccessMode: "exclude_data" as
      | "include_data"
      | "masked_data"
      | "exclude_data",
    accessMode: "view" as "view" | "use" | "edit",
    expiresAt: "",
  });

  const reload = async () => {
    if (!systemId || !currentOrganization) return;
    setLoading(true);
    const [list, sys] = await Promise.all([
      fetchSharePackages({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        systemId,
      }).catch(() => []),
      fetchSystem(systemId).catch(() => null),
    ]);
    setPackages(list);
    if (sys) setSystemName(sys.name);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, currentOrganization?.id, currentWorkspace?.id]);

  const submit = async () => {
    if (
      !systemId ||
      !currentOrganization ||
      !currentWorkspace ||
      !draft.name.trim()
    )
      return;
    setBusy(true);
    try {
      const created = await createSharePackage({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        systemId,
        name: draft.name.trim(),
        mode: draft.mode,
        dataAccessMode: draft.dataAccessMode,
        config: { accessMode: draft.accessMode },
        expiresAt: draft.expiresAt
          ? new Date(draft.expiresAt).toISOString()
          : undefined,
      });
      setPackages((cur) => [created, ...cur]);
      setDraft({ ...draft, name: "" });
      appendRunLog({
        level: "ok",
        text: `Share link created · ${created.name}`,
        source: "sharing",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Share failed: ${(err as Error).message}`,
        source: "sharing",
      });
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async (pkg: SharePackage) => {
    const url = `${window.location.origin}/share/${pkg.token}`;
    await navigator.clipboard.writeText(url);
    appendRunLog({ level: "ok", text: "Share URL copied", source: "sharing" });
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
        <Share2 className="h-4 w-4 text-indigo-400" />
        <h1 className="text-sm font-semibold">{systemName || "Share"}</h1>
        {loading && (
          <Loader2 className="ml-2 h-4 w-4 animate-spin text-app-faint" />
        )}
      </header>

      <section className="border-b border-app bg-app-hover p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Link name"
            className="border-app bg-app"
          />
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft({ ...draft, mode: e.target.value as typeof draft.mode })
            }
            className="rounded border border-app bg-app p-2 text-xs"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={draft.dataAccessMode}
            onChange={(e) =>
              setDraft({
                ...draft,
                dataAccessMode: e.target.value as typeof draft.dataAccessMode,
              })
            }
            className="rounded border border-app bg-app p-2 text-xs"
          >
            {DATA_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={draft.accessMode}
            onChange={(e) =>
              setDraft({
                ...draft,
                accessMode: e.target.value as typeof draft.accessMode,
              })
            }
            className="rounded border border-app bg-app p-2 text-xs"
          >
            {ACCESS_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <Input
            type="datetime-local"
            value={draft.expiresAt}
            onChange={(e) =>
              setDraft({ ...draft, expiresAt: e.target.value })
            }
            className="border-app bg-app"
          />
        </div>
        <Button
          onClick={() => void submit()}
          disabled={busy || !draft.name.trim()}
          size="sm"
          className="mt-3 gap-1"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create share link
        </Button>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {packages.length === 0 ? (
          <p className="px-4 py-6 text-sm text-app-faint">No share links.</p>
        ) : (
          <div className="divide-y divide-app">
            {packages.map((p) => (
              <div key={p.id} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-2">
                  <Share2 className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="font-semibold text-app">{p.name}</span>
                  <span className="rounded border border-app-strong px-1.5 py-0.5 text-[10px] uppercase text-app-subtle">
                    {p.mode.replace(/_/g, " ")}
                  </span>
                  <span className="rounded border border-app-strong px-1.5 py-0.5 text-[10px] uppercase text-app-subtle">
                    {p.dataAccessMode.replace(/_/g, " ")}
                  </span>
                  <span className="rounded border border-app-strong px-1.5 py-0.5 text-[10px] uppercase text-app-subtle">
                    {String(p.config?.accessMode ?? "view")}
                  </span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      p.status === "active"
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "bg-slate-700 text-app-muted"
                    }`}
                  >
                    {p.status}
                  </span>
                  <span className="ml-auto text-app-faint">
                    {p.expiresAt
                      ? `expires ${new Date(p.expiresAt).toLocaleDateString()}`
                      : "no expiry"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded border border-app bg-app px-2 py-1 font-mono text-[11px] text-app-muted">
                    {window.location.origin}/share/{p.token}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyToken(p)}
                    className="gap-1"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
