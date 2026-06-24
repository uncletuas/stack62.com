import { useCallback, useEffect, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { getApiBaseUrl, getStoredToken } from "../../lib/api";
import { listAudit, type Paginated } from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  StatusBadge,
  relTime,
} from "../components";

export function Audit() {
  const [action, setAction] = useState("");
  const [data, setData] = useState<Paginated<Record<string, unknown>> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listAudit({ action: action || undefined, pageSize: 100 })
      .then((d) => live && (setData(d), setLoading(false)))
      .catch((e: { message?: string }) => {
        if (!live) return;
        setError(e?.message ?? "Failed to load audit log.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [action]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const exportCsv = () => {
    const token = getStoredToken();
    const url = `${getApiBaseUrl()}/admin/audit/export.csv${
      action ? `?action=${encodeURIComponent(action)}` : ""
    }`;
    // Fetch with auth then trigger a download (the endpoint requires a bearer).
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "stack62-admin-audit.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => {});
  };

  return (
    <div>
      <ModuleHeader
        icon={ScrollText}
        title="Audit & Compliance"
        description="An immutable, cross-tenant record of platform activity."
        actions={
          <div className="flex items-center gap-2">
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Filter by action…"
              className="h-9 w-56 rounded-md border border-app bg-app px-3 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={exportCsv}
              className="flex h-9 items-center gap-1.5 rounded-md border border-app px-3 text-sm font-medium text-app-muted hover:bg-app-hover"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>
        }
      />
      <AsyncBoundary loading={loading} error={error} onRetry={load}>
        <div className="p-6">
          <div className="rounded-xl border border-app bg-app-elevated">
            <DataTable
              rows={data?.items ?? []}
              rowKey={(r) => String(r.id)}
              columns={[
                {
                  key: "action",
                  header: "Action",
                  render: (r) => (
                    <span className="font-medium">
                      {String(r.action).replace(/\./g, " ")}
                    </span>
                  ),
                },
                {
                  key: "target",
                  header: "Target",
                  render: (r) => String(r.targetType),
                },
                {
                  key: "origin",
                  header: "Origin",
                  render: (r) => <StatusBadge value={String(r.origin)} />,
                },
                {
                  key: "actor",
                  header: "Actor",
                  render: (r) =>
                    r.actorUserId ? String(r.actorUserId).slice(0, 8) : "system",
                },
                {
                  key: "org",
                  header: "Org",
                  render: (r) =>
                    r.organizationId
                      ? String(r.organizationId).slice(0, 8)
                      : "—",
                },
                {
                  key: "time",
                  header: "When",
                  render: (r) => (
                    <span className="text-app-muted">
                      {relTime(r.createdAt as string)}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </AsyncBoundary>
    </div>
  );
}
