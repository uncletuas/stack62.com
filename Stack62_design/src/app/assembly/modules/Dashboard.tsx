import { useNavigate } from "react-router";
import { LayoutDashboard } from "lucide-react";
import { getDashboardOverview } from "../lib/admin-api";
import {
  AsyncBoundary,
  ModuleHeader,
  StatCard,
  money,
  useAsync,
} from "../components";

export function Dashboard() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(getDashboardOverview);

  return (
    <div>
      <ModuleHeader
        icon={LayoutDashboard}
        title="Platform Dashboard"
        description="A live overview of the entire Stack62 platform."
      />
      <AsyncBoundary loading={loading} error={error} onRetry={reload}>
        {data && (
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              <StatCard
                label="Organizations"
                value={data.organizations.total}
                onClick={() => navigate("/assembly/organizations")}
              />
              <StatCard
                label="Total users"
                value={data.users.total}
                sub={`${data.users.active} active`}
                onClick={() => navigate("/assembly/users")}
              />
              <StatCard
                label="New users (24h)"
                value={data.users.new24h}
                tone={data.users.new24h > 0 ? "good" : "default"}
              />
              <StatCard
                label="Active subscriptions"
                value={data.subscriptions.active}
                onClick={() => navigate("/assembly/billing")}
              />
              <StatCard
                label="MRR"
                value={money(data.revenue.mrrCents, data.revenue.currency)}
                onClick={() => navigate("/assembly/billing")}
              />
              <StatCard
                label="AI requests (24h)"
                value={data.ai.requests24h}
                sub={`${data.ai.failures24h} failed`}
                tone={data.ai.failures24h > 0 ? "warn" : "default"}
                onClick={() => navigate("/assembly/ai")}
              />
              <StatCard
                label="Open tickets"
                value={data.support.openTickets}
                tone={data.support.openTickets > 0 ? "warn" : "good"}
                onClick={() => navigate("/assembly/support")}
              />
              <StatCard
                label="Security incidents"
                value={data.security.openIncidents}
                tone={data.security.openIncidents > 0 ? "bad" : "good"}
                onClick={() => navigate("/assembly/security")}
              />
              <StatCard
                label="Jobs running"
                value={data.jobs.running}
                sub={`${data.jobs.failed7d} failed (7d)`}
                onClick={() => navigate("/assembly/infra")}
              />
            </div>
            <p className="text-xs text-app-faint">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}
