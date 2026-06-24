import { useCallback, useEffect, useState } from "react";
import { Search, Users as UsersIcon } from "lucide-react";
import {
  activateUser,
  listUsers,
  suspendUser,
  verifyUserEmail,
  type AdminUser,
  type Paginated,
} from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  StatusBadge,
  shortDate,
} from "../components";

export function Users() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<Paginated<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listUsers({ search: search || undefined, status: status || undefined, pageSize: 50 })
      .then((d) => live && (setData(d), setLoading(false)))
      .catch((e: { message?: string }) => {
        if (!live) return;
        setError(e?.message ?? "Failed to load users.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setActing(id);
    try {
      await fn(id);
      load();
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <ModuleHeader
        icon={UsersIcon}
        title="User Management"
        description="Search, inspect, and manage every user on the platform."
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search email or name…"
                className="h-9 w-64 rounded-md border border-app bg-app pl-8 pr-3 text-sm outline-none focus:border-accent"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 rounded-md border border-app bg-app px-2 text-sm outline-none"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        }
      />
      <AsyncBoundary loading={loading} error={error} onRetry={load}>
        <div className="p-6">
          <div className="rounded-xl border border-app bg-app-elevated">
            <div className="flex items-center justify-between border-b border-app px-4 py-2.5 text-xs text-app-faint">
              <span>{data?.total ?? 0} users</span>
            </div>
            <DataTable
              rows={data?.items ?? []}
              rowKey={(u) => u.id}
              columns={[
                {
                  key: "name",
                  header: "User",
                  render: (u) => (
                    <div>
                      <div className="font-medium">
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-app-faint">{u.email}</div>
                    </div>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (u) => <StatusBadge value={u.status} />,
                },
                {
                  key: "role",
                  header: "Platform role",
                  render: (u) =>
                    u.platformRole ? (
                      <StatusBadge value={u.platformRole} />
                    ) : (
                      <span className="text-app-faint">—</span>
                    ),
                },
                {
                  key: "verified",
                  header: "Verified",
                  render: (u) => (u.emailVerifiedAt ? "Yes" : "No"),
                },
                {
                  key: "joined",
                  header: "Joined",
                  render: (u) => (
                    <span className="text-app-muted">
                      {shortDate(u.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (u) => (
                    <div className="flex justify-end gap-1.5">
                      {u.status === "active" ? (
                        <button
                          disabled={acting === u.id}
                          onClick={() => act(u.id, suspendUser)}
                          className="rounded-md border border-app px-2 py-1 text-[11px] font-medium text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          disabled={acting === u.id}
                          onClick={() => act(u.id, activateUser)}
                          className="rounded-md border border-app px-2 py-1 text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          Activate
                        </button>
                      )}
                      {!u.emailVerifiedAt && (
                        <button
                          disabled={acting === u.id}
                          onClick={() => act(u.id, verifyUserEmail)}
                          className="rounded-md border border-app px-2 py-1 text-[11px] font-medium text-app-muted hover:bg-app-hover disabled:opacity-50"
                        >
                          Verify
                        </button>
                      )}
                    </div>
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
