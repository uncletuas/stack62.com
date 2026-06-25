import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Usage {
  windowDays: number;
  requests: number;
  failures: number;
  successRatePct: number;
  providers: { provider: string; count: number }[];
  models: { model: string; count: number }[];
  tasks: { taskType: string; count: number }[];
}
interface LogRow {
  id: string;
  provider: string;
  model: string;
  taskType: string;
  status: string;
  organizationId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function AiPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [u, l] = await Promise.all([
        api<Usage>('/ai/usage'),
        api<LogRow[]>('/ai/logs'),
      ]);
      setUsage(u);
      setLogs(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load AI data.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">AI Management Center</h1>
      <p className="mt-1 text-sm text-slate-400">
        Platform AI usage, provider/model mix, and recent request activity
        (last {usage?.windowDays ?? 7} days).
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requests" value={usage?.requests ?? 0} />
        <Stat label="Failures" value={usage?.failures ?? 0} tone="warn" />
        <Stat label="Success rate" value={`${usage?.successRatePct ?? 100}%`} tone="good" />
        <Stat label="Providers" value={usage?.providers.length ?? 0} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MiniTable title="By provider" rows={usage?.providers.map((p) => [p.provider, p.count]) ?? []} />
        <MiniTable title="Top models" rows={usage?.models.map((m) => [m.model, m.count]) ?? []} />
        <MiniTable title="By task" rows={usage?.tasks.map((t) => [t.taskType, t.count]) ?? []} />
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Recent requests
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Task</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No AI requests recorded yet.
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-slate-200">{l.provider}</td>
                  <td className="px-4 py-2.5 text-slate-400">{l.model}</td>
                  <td className="px-4 py-2.5 text-slate-400">{l.taskType}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        l.status === 'failed'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-emerald-900 text-emerald-300'
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'warn';
}) {
  const color =
    tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-white';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="mb-2 text-sm font-semibold text-white">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-500">No data yet.</div>
      ) : (
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="truncate text-slate-300">{k}</span>
              <span className="text-slate-500">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
