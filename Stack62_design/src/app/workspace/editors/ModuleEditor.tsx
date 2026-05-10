import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Table } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import {
  fetchRecords,
  fetchSystem,
  type EntityDefinition,
  type FieldDefinition,
  type ModuleDefinition,
  type RuntimeRecord,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function ModuleEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { navigate } = useWorkspace();
  const [module, setModule] = useState<ModuleDefinition | null>(null);
  const [systemName, setSystemName] = useState("");
  const [records, setRecords] = useState<RuntimeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!tab.parentRefId || !tab.refId) return;
    let live = true;
    setLoading(true);
    void fetchSystem(tab.parentRefId)
      .then((sys) => {
        if (!live) return;
        setSystemName(sys.name);
        setModule(sys.modules.find((m) => m.id === tab.refId) ?? null);
      })
      .catch(() => live && setModule(null));
    return () => {
      live = false;
    };
  }, [tab.parentRefId, tab.refId]);

  useEffect(() => {
    if (!currentOrganization || !tab.parentRefId || !tab.refId) return;
    let live = true;
    setLoading(true);
    fetchRecords({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
      systemId: tab.parentRefId,
      moduleDefinitionId: tab.refId,
    })
      .then((rows) => live && setRecords(rows))
      .catch(() => live && setRecords([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [currentOrganization, currentWorkspace?.id, tab.parentRefId, tab.refId]);

  const entity: EntityDefinition | undefined = module?.entities[0];
  const fields: FieldDefinition[] = entity?.fields ?? [];

  const filtered = useMemo(() => {
    if (!query) return records;
    const q = query.toLowerCase();
    return records.filter((r) =>
      JSON.stringify(r.data ?? {})
        .toLowerCase()
        .includes(q),
    );
  }, [records, query]);

  if (!module) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Module not found."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-app text-app">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Table className="h-4 w-4 text-indigo-400" />
        <div>
          <h1 className="text-sm font-semibold">{module.name}</h1>
          <p className="text-[11px] text-app-faint">
            {systemName} · {module.kind} · {records.length} records
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-faint" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-8 w-56 border-app bg-app-surface pl-7 text-xs"
            />
          </div>
          <Button size="sm" className="gap-1">
            <Plus className="h-3.5 w-3.5" /> New record
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="grid h-full place-items-center text-app-faint">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-app-faint">
            No records.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-app-surface text-[10px] uppercase tracking-wider text-app-faint">
              <tr>
                <th className="px-3 py-2 text-left">Status</th>
                {fields.slice(0, 6).map((f) => (
                  <th key={f.id} className="px-3 py-2 text-left">
                    {f.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-app hover:bg-white/5"
                  onClick={() =>
                    navigate({
                      kind: "record",
                      title: previewLabel(r, fields) ?? "Record",
                      refId: r.id,
                      parentRefId: tab.parentRefId,
                    })
                  }
                >
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-app-strong px-2 py-0.5 text-[10px] uppercase text-app-subtle">
                      {r.status}
                    </span>
                  </td>
                  {fields.slice(0, 6).map((f) => (
                    <td
                      key={f.id}
                      className="max-w-[240px] truncate px-3 py-2 text-app"
                    >
                      {formatCell((r.data as Record<string, unknown>)?.[f.key])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-app-faint">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function previewLabel(r: RuntimeRecord, fields: FieldDefinition[]) {
  const data = (r.data as Record<string, unknown>) ?? {};
  const candidate =
    fields.find((f) => /name|title|label/i.test(f.key))?.key ?? fields[0]?.key;
  if (!candidate) return null;
  const v = data[candidate];
  return typeof v === "string" ? v : JSON.stringify(v);
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
