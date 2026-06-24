import { Activity } from "lucide-react";
import { getActivity } from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  StatusBadge,
  relTime,
  useAsync,
} from "../components";

export function ActivityFeed() {
  const { data, loading, error, reload } = useAsync(() => getActivity(100));

  return (
    <div>
      <ModuleHeader
        icon={Activity}
        title="Platform Activity"
        description="The most recent platform-wide events, across every tenant."
      />
      <AsyncBoundary loading={loading} error={error} onRetry={reload}>
        <div className="p-6">
          <div className="rounded-xl border border-app bg-app-elevated">
            <DataTable
              rows={data ?? []}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "action",
                  header: "Action",
                  render: (r) => (
                    <span className="font-medium">
                      {r.action.replace(/\./g, " ")}
                    </span>
                  ),
                },
                { key: "target", header: "Target", render: (r) => r.targetType },
                {
                  key: "origin",
                  header: "Origin",
                  render: (r) => <StatusBadge value={r.origin} />,
                },
                {
                  key: "org",
                  header: "Org",
                  render: (r) =>
                    r.organizationId ? r.organizationId.slice(0, 8) : "—",
                },
                {
                  key: "time",
                  header: "When",
                  render: (r) => (
                    <span className="text-app-muted">{relTime(r.createdAt)}</span>
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
