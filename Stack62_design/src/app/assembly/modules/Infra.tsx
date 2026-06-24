import { Database } from "lucide-react";
import { getQueueHealth, listJobs, type Paginated } from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
  relTime,
  useAsync,
} from "../components";

export function Infra() {
  const queues = useAsync(getQueueHealth);
  const jobs = useAsync<Paginated<Record<string, unknown>>>(() =>
    listJobs({ pageSize: 50 }),
  );

  return (
    <div>
      <ModuleHeader
        icon={Database}
        title="Engineering & Infrastructure"
        description="Queue health and recent background jobs. Elevated access only."
      />
      <AsyncBoundary loading={queues.loading} error={queues.error} onRetry={queues.reload}>
        <div className="space-y-6 p-6">
          <Panel title="Queue health">
            <DataTable
              rows={queues.data ?? []}
              rowKey={(q) => q.queue}
              empty="No jobs recorded yet."
              columns={[
                { key: "q", header: "Queue", render: (q) => q.queue },
                { key: "total", header: "Total", render: (q) => q.total },
                {
                  key: "status",
                  header: "By status",
                  render: (q) => (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(q.statuses).map(([s, n]) => (
                        <StatusBadge key={s} value={`${s}: ${n}`} />
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Recent jobs">
            <DataTable
              rows={jobs.data?.items ?? []}
              rowKey={(j) => String(j.id)}
              columns={[
                { key: "q", header: "Queue", render: (j) => String(j.queueName) },
                { key: "type", header: "Type", render: (j) => String(j.jobType) },
                {
                  key: "status",
                  header: "Status",
                  render: (j) => <StatusBadge value={String(j.status)} />,
                },
                {
                  key: "progress",
                  header: "Progress",
                  render: (j) => `${Number(j.progress) || 0}%`,
                },
                {
                  key: "time",
                  header: "Created",
                  render: (j) => (
                    <span className="text-app-muted">
                      {relTime(j.createdAt as string)}
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
