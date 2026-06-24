import { Plug } from "lucide-react";
import {
  getIntegrationProviders,
  listConnections,
  type Paginated,
} from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
  shortDate,
  useAsync,
} from "../components";

export function Integrations() {
  const providers = useAsync(getIntegrationProviders);
  const connections = useAsync<Paginated<Record<string, unknown>>>(() =>
    listConnections({ pageSize: 50 }),
  );

  return (
    <div>
      <ModuleHeader
        icon={Plug}
        title="API & Integrations"
        description="Third-party connections across all tenants."
      />
      <AsyncBoundary
        loading={providers.loading}
        error={providers.error}
        onRetry={providers.reload}
      >
        <div className="space-y-6 p-6">
          <Panel title="Providers">
            <DataTable
              rows={providers.data ?? []}
              rowKey={(p) => p.provider}
              empty="No integration connections yet."
              columns={[
                { key: "p", header: "Provider", render: (p) => p.provider },
                {
                  key: "total",
                  header: "Connections",
                  render: (p) => p.total,
                },
                {
                  key: "status",
                  header: "Breakdown",
                  render: (p) => (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(p.statuses).map(([s, n]) => (
                        <span key={s} className="text-xs text-app-muted">
                          {s}: {n}
                        </span>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel title="Connections">
            <DataTable
              rows={connections.data?.items ?? []}
              rowKey={(c) => String(c.id)}
              columns={[
                {
                  key: "prov",
                  header: "Provider",
                  render: (c) => String(c.providerKey),
                },
                {
                  key: "org",
                  header: "Org",
                  render: (c) => String(c.organizationId).slice(0, 8),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (c) => <StatusBadge value={String(c.status)} />,
                },
                {
                  key: "created",
                  header: "Created",
                  render: (c) => (
                    <span className="text-app-muted">
                      {shortDate(c.createdAt as string)}
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
