import { Bot } from "lucide-react";
import { getAiUsage, listAiLogs, type Paginated } from "../lib/admin-api";
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

export function Ai() {
  const usage = useAsync(getAiUsage);
  const logs = useAsync<Paginated<Record<string, unknown>>>(() =>
    listAiLogs({ pageSize: 50 }),
  );

  return (
    <div>
      <ModuleHeader
        icon={Bot}
        title="AI Management Center"
        description="Provider usage, model mix, and recent AI request logs."
      />
      <AsyncBoundary loading={usage.loading} error={usage.error} onRetry={usage.reload}>
        {usage.data && (
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label={`Requests (${usage.data.windowDays}d)`}
                value={usage.data.requests}
              />
              <StatCard
                label="Failures"
                value={usage.data.failures}
                tone={usage.data.failures > 0 ? "warn" : "good"}
              />
              <StatCard
                label="Success rate"
                value={`${usage.data.successRatePct}%`}
                tone={usage.data.successRatePct >= 95 ? "good" : "warn"}
              />
              <StatCard label="Providers" value={usage.data.byProvider.length} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="By provider">
                <DataTable
                  rows={usage.data.byProvider}
                  rowKey={(r) => r.provider}
                  empty="No AI requests yet."
                  columns={[
                    { key: "p", header: "Provider", render: (r) => r.provider },
                    { key: "c", header: "Requests", render: (r) => r.count },
                  ]}
                />
              </Panel>
              <Panel title="Top models">
                <DataTable
                  rows={usage.data.byModel}
                  rowKey={(r) => r.model}
                  empty="No AI requests yet."
                  columns={[
                    { key: "m", header: "Model", render: (r) => r.model },
                    { key: "c", header: "Requests", render: (r) => r.count },
                  ]}
                />
              </Panel>
            </div>

            <Panel title="Recent requests">
              <DataTable
                rows={logs.data?.items ?? []}
                rowKey={(r) => String(r.id)}
                columns={[
                  { key: "prov", header: "Provider", render: (r) => String(r.provider) },
                  { key: "model", header: "Model", render: (r) => String(r.model) },
                  { key: "task", header: "Task", render: (r) => String(r.taskType) },
                  {
                    key: "status",
                    header: "Status",
                    render: (r) => <StatusBadge value={String(r.status)} />,
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
            </Panel>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
