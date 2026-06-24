import { useCallback, useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import {
  getSupportStats,
  listTickets,
  updateTicket,
  type Paginated,
} from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatCard,
  StatusBadge,
  relTime,
  useAsync,
} from "../components";

export function Support() {
  const stats = useAsync(getSupportStats);
  const [status, setStatus] = useState("");
  const [tickets, setTickets] =
    useState<Paginated<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    listTickets({ status: status || undefined, pageSize: 50 })
      .then((d) => live && (setTickets(d), setLoading(false)))
      .catch((e: { message?: string }) => {
        if (!live) return;
        setError(e?.message ?? "Failed to load tickets.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [status]);
  useEffect(() => load(), [load]);

  const resolve = async (id: string) => {
    await updateTicket(id, { status: "resolved" });
    load();
    stats.reload();
  };

  return (
    <div>
      <ModuleHeader
        icon={LifeBuoy}
        title="Support & Customer Operations"
        description="Tickets, SLA tracking, and customer satisfaction."
        actions={
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-app bg-app px-2 text-sm"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        }
      />
      <div className="space-y-6 p-6">
        {stats.data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Open" value={stats.data.open} tone="warn" />
            <StatCard label="Pending" value={stats.data.pending} />
            <StatCard label="Resolved" value={stats.data.resolved} tone="good" />
            <StatCard
              label="SLA breached"
              value={stats.data.slaBreached}
              tone={stats.data.slaBreached > 0 ? "bad" : "good"}
            />
            <StatCard
              label="Avg CSAT"
              value={stats.data.avgCsat ?? "—"}
              tone="good"
            />
          </div>
        )}
        <AsyncBoundary loading={loading} error={error} onRetry={load}>
          <Panel title="Tickets">
            <DataTable
              rows={tickets?.items ?? []}
              rowKey={(t) => String(t.id)}
              empty="No tickets. Customers are happy."
              columns={[
                {
                  key: "subject",
                  header: "Subject",
                  render: (t) => (
                    <span className="font-medium">{String(t.subject)}</span>
                  ),
                },
                {
                  key: "priority",
                  header: "Priority",
                  render: (t) => <StatusBadge value={String(t.priority)} />,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (t) => <StatusBadge value={String(t.status)} />,
                },
                {
                  key: "created",
                  header: "Opened",
                  render: (t) => (
                    <span className="text-app-muted">
                      {relTime(t.createdAt as string)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (t) =>
                    !["resolved", "closed"].includes(String(t.status)) ? (
                      <button
                        onClick={() => resolve(String(t.id))}
                        className="rounded-md border border-app px-2 py-1 text-[11px] font-medium text-emerald-500 hover:bg-emerald-500/10"
                      >
                        Resolve
                      </button>
                    ) : null,
                },
              ]}
            />
          </Panel>
        </AsyncBoundary>
      </div>
    </div>
  );
}
