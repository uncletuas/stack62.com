import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import {
  createIpRule,
  deleteIpRule,
  getLoginEvents,
  listIncidents,
  listIpRules,
  setIncidentStatus,
} from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
  relTime,
  useAsync,
} from "../components";

export function Security() {
  const events = useAsync<Record<string, unknown>[]>(() => getLoginEvents(40));
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [incidents, setIncidents] = useState<Record<string, unknown>[]>([]);
  const [cidr, setCidr] = useState("");
  const [kind, setKind] = useState<"allow" | "block">("block");

  const loadRules = useCallback(() => {
    listIpRules().then(setRules).catch(() => setRules([]));
  }, []);
  const loadIncidents = useCallback(() => {
    listIncidents().then(setIncidents).catch(() => setIncidents([]));
  }, []);
  useEffect(() => {
    loadRules();
    loadIncidents();
  }, [loadRules, loadIncidents]);

  const addRule = async () => {
    if (!cidr.trim()) return;
    await createIpRule({ cidr: cidr.trim(), kind });
    setCidr("");
    loadRules();
  };

  return (
    <div>
      <ModuleHeader
        icon={ShieldCheck}
        title="Security Center"
        description="Authentication activity, IP rules, and incident response."
      />
      <AsyncBoundary loading={events.loading} error={events.error} onRetry={events.reload}>
        <div className="space-y-6 p-6">
          <Panel title="IP rules">
            <div className="flex flex-wrap items-center gap-2 border-b border-app px-4 py-3">
              <input
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="CIDR or IP (e.g. 1.2.3.4/32)"
                className="h-9 w-64 rounded-md border border-app bg-app px-3 text-sm outline-none focus:border-accent"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "allow" | "block")}
                className="h-9 rounded-md border border-app bg-app px-2 text-sm"
              >
                <option value="block">Block</option>
                <option value="allow">Allow</option>
              </select>
              <button
                onClick={addRule}
                className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>
            <DataTable
              rows={rules}
              rowKey={(r) => String(r.id)}
              empty="No IP rules configured."
              columns={[
                { key: "cidr", header: "CIDR", render: (r) => String(r.cidr) },
                {
                  key: "kind",
                  header: "Kind",
                  render: (r) => <StatusBadge value={String(r.kind)} />,
                },
                {
                  key: "reason",
                  header: "Reason",
                  render: (r) => String(r.reason ?? "—"),
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (r) => (
                    <button
                      onClick={async () => {
                        await deleteIpRule(String(r.id));
                        loadRules();
                      }}
                      className="text-rose-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Incidents">
            <DataTable
              rows={incidents}
              rowKey={(i) => String(i.id)}
              empty="No security incidents. All clear."
              columns={[
                { key: "title", header: "Incident", render: (i) => String(i.title) },
                {
                  key: "sev",
                  header: "Severity",
                  render: (i) => <StatusBadge value={String(i.severity)} />,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (i) => <StatusBadge value={String(i.status)} />,
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (i) =>
                    String(i.status) !== "closed" ? (
                      <button
                        onClick={async () => {
                          await setIncidentStatus(String(i.id), "closed");
                          loadIncidents();
                        }}
                        className="rounded-md border border-app px-2 py-1 text-[11px] font-medium text-app-muted hover:bg-app-hover"
                      >
                        Close
                      </button>
                    ) : null,
                },
              ]}
            />
          </Panel>

          <Panel title="Recent authentication events">
            <DataTable
              rows={events.data ?? []}
              rowKey={(e) => String(e.id)}
              columns={[
                {
                  key: "action",
                  header: "Event",
                  render: (e) => String(e.action).replace(/\./g, " "),
                },
                {
                  key: "actor",
                  header: "User",
                  render: (e) =>
                    e.actorUserId ? String(e.actorUserId).slice(0, 8) : "—",
                },
                {
                  key: "time",
                  header: "When",
                  render: (e) => (
                    <span className="text-app-muted">
                      {relTime(e.createdAt as string)}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      </AsyncBoundary>
    </div>
  );
}
