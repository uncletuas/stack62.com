import { CreditCard } from "lucide-react";
import {
  getRevenue,
  listSubscriptions,
  type Paginated,
  type RevenueSummary,
} from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatCard,
  StatusBadge,
  money,
  shortDate,
  useAsync,
} from "../components";

export function Billing() {
  const revenue = useAsync(getRevenue);
  const subs = useAsync<Paginated<Record<string, unknown>>>(() =>
    listSubscriptions({ pageSize: 50 }),
  );

  return (
    <div>
      <ModuleHeader
        icon={CreditCard}
        title="Subscriptions & Revenue"
        description="Plan distribution, recurring revenue, and active subscriptions."
      />
      <AsyncBoundary
        loading={revenue.loading}
        error={revenue.error}
        onRetry={revenue.reload}
      >
        {revenue.data && (
          <div className="space-y-6 p-6">
            <Summary data={revenue.data} />
            <Panel title="Active subscriptions">
              <DataTable
                rows={subs.data?.items ?? []}
                rowKey={(s) => String(s.id)}
                columns={[
                  {
                    key: "org",
                    header: "Organization",
                    render: (s) => String(s.organizationId).slice(0, 8),
                  },
                  {
                    key: "plan",
                    header: "Plan",
                    render: (s) => <StatusBadge value={String(s.planTier)} />,
                  },
                  {
                    key: "interval",
                    header: "Interval",
                    render: (s) => String(s.interval),
                  },
                  { key: "seats", header: "Seats", render: (s) => Number(s.seats) },
                  {
                    key: "value",
                    header: "Monthly",
                    render: (s) => money(Number(s.monthlyValueCents) || 0),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (s) => <StatusBadge value={String(s.status)} />,
                  },
                  {
                    key: "renews",
                    header: "Renews",
                    render: (s) => (
                      <span className="text-app-muted">
                        {shortDate(s.currentPeriodEnd as string)}
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

function Summary({ data }: { data: RevenueSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="MRR" value={money(data.mrrCents, data.currency)} />
        <StatCard label="ARR" value={money(data.arrCents, data.currency)} />
        <StatCard label="Active subs" value={data.activeSubscriptions} />
        <StatCard label="Paid tiers" value={data.byTier.length} />
      </div>
      <Panel title="By plan tier">
        <DataTable
          rows={data.byTier}
          rowKey={(t) => t.tier}
          columns={[
            {
              key: "tier",
              header: "Tier",
              render: (t) => <StatusBadge value={t.tier} />,
            },
            { key: "count", header: "Subscriptions", render: (t) => t.count },
            {
              key: "mrr",
              header: "MRR",
              render: (t) => money(t.mrrCents, data.currency),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
