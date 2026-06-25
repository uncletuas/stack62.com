import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken } from '../lib/api';
import type { AuditRow } from '../lib/types';

const ADMIN_API_BASE_URL = (
  import.meta.env.VITE_ADMIN_API_BASE_URL || '/v1/admin'
).replace(/\/$/, '');

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    action: '',
    organizationId: '',
    origin: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<AuditRow[]>('/audit', {
        query: {
          action: filters.action || undefined,
          organizationId: filters.organizationId || undefined,
          origin: filters.origin || undefined,
          limit: 200,
        },
      });
      setRows(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    const url = new URL(
      `${ADMIN_API_BASE_URL}/audit/export`,
      window.location.origin,
    );
    if (filters.action) url.searchParams.set('action', filters.action);
    if (filters.organizationId)
      url.searchParams.set('organizationId', filters.organizationId);
    if (filters.origin) url.searchParams.set('origin', filters.origin);
    // Fetch with auth, then trigger a download (the endpoint needs the bearer).
    void (async () => {
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'audit-log.csv';
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed.');
      }
    })();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Audit Log</h1>
          <p className="mt-1 text-sm text-slate-400">
            Cross-organization activity and every staff action.
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Export CSV
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <FilterInput
          placeholder="Action contains…"
          value={filters.action}
          onChange={(v) => setFilters({ ...filters, action: v })}
        />
        <FilterInput
          placeholder="Organization ID"
          value={filters.organizationId}
          onChange={(v) => setFilters({ ...filters, organizationId: v })}
        />
        <select
          value={filters.origin}
          onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">All origins</option>
          <option value="user">user</option>
          <option value="system">system (staff)</option>
          <option value="ai">ai</option>
        </select>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Origin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No matching entries.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-indigo-300">
                    {r.action}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {r.actorUserId ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {r.targetType}:{r.targetId}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      {r.origin}
                    </span>
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

function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
    />
  );
}
