import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Overview {
  status: string;
  timestamp: string;
  database: { reachable: boolean };
  counts: { organizations: number; users: number; activeSubscriptions: number };
  jobs: {
    byStatus: { status: string; count: number }[];
    failedLast24h: number;
  };
}

interface ErrorEvent {
  kind: string;
  at: string;
  summary: string;
  organizationId: string | null;
}

export function MonitoringPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, e] = await Promise.all([
        api<Overview>('/monitoring/overview'),
        api<ErrorEvent[]>('/monitoring/errors'),
      ]);
      setOverview(o);
      setErrors(e);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load monitoring.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Monitoring & Errors</h1>
          <p className="mt-1 text-sm text-slate-400">
            Platform health, queue state, and the operational error feed.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {overview && (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat
            label="Status"
            value={overview.status}
            ok={overview.status === 'ok'}
          />
          <Stat
            label="Database"
            value={overview.database.reachable ? 'reachable' : 'down'}
            ok={overview.database.reachable}
          />
          <Stat label="Organizations" value={String(overview.counts.organizations)} />
          <Stat label="Users" value={String(overview.counts.users)} />
          <Stat
            label="Active subscriptions"
            value={String(overview.counts.activeSubscriptions)}
          />
          <Stat
            label="Failed jobs (24h)"
            value={String(overview.jobs.failedLast24h)}
            ok={overview.jobs.failedLast24h === 0}
          />
          {overview.jobs.byStatus.map((j) => (
            <Stat key={j.status} label={`Jobs: ${j.status}`} value={String(j.count)} />
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Error feed
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {errors.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                  No recent errors. 🎉
                </td>
              </tr>
            ) : (
              errors.map((e, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(e.at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-amber-300">
                      {e.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{e.summary}</td>
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
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${
          ok === undefined
            ? 'text-white'
            : ok
              ? 'text-emerald-400'
              : 'text-red-400'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
