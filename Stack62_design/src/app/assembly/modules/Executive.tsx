import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getExecutiveKpis } from "../lib/admin-api";
import {
  AsyncBoundary,
  ModuleHeader,
  Panel,
  StatCard,
  money,
  useAsync,
} from "../components";

export function Executive() {
  const { data, loading, error, reload } = useAsync(getExecutiveKpis);

  return (
    <div>
      <ModuleHeader
        icon={BarChart3}
        title="Executive Command Center"
        description="Strategic KPIs and growth trends across the business."
      />
      <AsyncBoundary loading={loading} error={error} onRetry={reload}>
        {data && (
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="MRR" value={money(data.mrrCents, data.currency)} />
              <StatCard label="ARR" value={money(data.arrCents, data.currency)} />
              <StatCard
                label="Active organizations"
                value={data.activeOrganizations}
              />
              <StatCard
                label="Signups (30d)"
                value={data.signups30d}
                sub={
                  data.signupGrowthPct === null
                    ? "no prior period"
                    : `${data.signupGrowthPct > 0 ? "+" : ""}${data.signupGrowthPct}% vs prev 30d`
                }
                tone={
                  data.signupGrowthPct === null
                    ? "default"
                    : data.signupGrowthPct >= 0
                      ? "good"
                      : "bad"
                }
              />
            </div>

            <Panel title="Signups — last 30 days">
              <div className="h-64 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.signupTrend}>
                    <defs>
                      <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="var(--app-accent)"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--app-accent)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--app-border)"
                    />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "var(--app-text-faint)" }}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--app-text-faint)" }}
                      width={28}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--app-elevated)",
                        border: "1px solid var(--app-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="var(--app-accent)"
                      fill="url(#sg)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
