import { useCallback, useEffect, useState } from "react";
import { Building2, Search } from "lucide-react";
import { listOrgs, type AdminOrg, type Paginated } from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  StatusBadge,
  shortDate,
} from "../components";

export function Organizations() {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Paginated<AdminOrg> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listOrgs({ search: search || undefined, pageSize: 50 })
      .then((d) => live && (setData(d), setLoading(false)))
      .catch((e: { message?: string }) => {
        if (!live) return;
        setError(e?.message ?? "Failed to load organizations.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <ModuleHeader
        icon={Building2}
        title="Organization Management"
        description="Every registered company and workspace on the platform."
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or slug…"
              className="h-9 w-64 rounded-md border border-app bg-app pl-8 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
        }
      />
      <AsyncBoundary loading={loading} error={error} onRetry={load}>
        <div className="p-6">
          <div className="rounded-xl border border-app bg-app-elevated">
            <div className="border-b border-app px-4 py-2.5 text-xs text-app-faint">
              {data?.total ?? 0} organizations
            </div>
            <DataTable
              rows={data?.items ?? []}
              rowKey={(o) => o.id}
              columns={[
                {
                  key: "name",
                  header: "Organization",
                  render: (o) => (
                    <div>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-app-faint">{o.slug}</div>
                    </div>
                  ),
                },
                {
                  key: "plan",
                  header: "Plan",
                  render: (o) => <StatusBadge value={o.planTier} />,
                },
                {
                  key: "members",
                  header: "Members",
                  render: (o) => o.memberCount,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (o) => <StatusBadge value={o.status} />,
                },
                {
                  key: "created",
                  header: "Created",
                  render: (o) => (
                    <span className="text-app-muted">
                      {shortDate(o.createdAt)}
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
