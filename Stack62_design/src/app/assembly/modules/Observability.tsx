import { Gauge } from "lucide-react";
import { getObservability } from "../lib/admin-api";
import {
  AsyncBoundary,
  ModuleHeader,
  Panel,
  StatCard,
  useAsync,
} from "../components";

function gb(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function mb(bytes: number) {
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
function uptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export function Observability() {
  const { data, loading, error, reload } = useAsync(getObservability);

  return (
    <div>
      <ModuleHeader
        icon={Gauge}
        title="Monitoring & Observability"
        description="Live process and host health for the API service."
        actions={
          <button
            onClick={reload}
            className="h-9 rounded-md border border-app px-3 text-sm font-medium text-app-muted hover:bg-app-hover"
          >
            Refresh
          </button>
        }
      />
      <AsyncBoundary loading={loading} error={error} onRetry={reload}>
        {data && (
          <div className="space-y-6 p-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Uptime" value={uptime(data.uptimeSeconds)} />
              <StatCard
                label="Host memory used"
                value={`${data.memory.hostUsedPct}%`}
                tone={data.memory.hostUsedPct > 85 ? "bad" : "good"}
              />
              <StatCard label="Load (1m)" value={data.load["1m"].toFixed(2)} />
              <StatCard label="CPU cores" value={data.cpuCount} />
            </div>

            <Panel title="Process memory">
              <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                <Metric label="RSS" value={mb(data.memory.rssBytes)} />
                <Metric label="Heap used" value={mb(data.memory.heapUsedBytes)} />
                <Metric label="Heap total" value={mb(data.memory.heapTotalBytes)} />
                <Metric label="Host total" value={gb(data.memory.hostTotalBytes)} />
              </div>
            </Panel>

            <p className="text-xs text-app-faint">
              Node {data.node} · updated{" "}
              {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </AsyncBoundary>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-app-faint">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-app">{value}</div>
    </div>
  );
}
