import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken } from '../lib/api';

const ADMIN_API_BASE_URL = (
  import.meta.env.VITE_ADMIN_API_BASE_URL || '/v1/admin'
).replace(/\/$/, '');

interface DbStatus {
  connected: boolean;
  hasPendingMigrations: boolean;
  executedMigrations: { name: string; timestamp: string }[];
  knownMigrations: string[];
  database: { sizePretty: string; tableCount: number };
}
interface TableStat {
  table: string;
  rows: number;
  size: string;
}

export function DatabasePage() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [tables, setTables] = useState<TableStat[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, t] = await Promise.all([
        api<DbStatus>('/database/status'),
        api<TableStat[]>('/database/tables'),
      ]);
      setStatus(s);
      setTables(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load database status.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function downloadBackup() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await fetch(`${ADMIN_API_BASE_URL}/database/backup`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(`Backup failed (${res.status})`);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const cd = res.headers.get('content-disposition') ?? '';
      link.download = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'stack62-backup.json';
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice('Backup downloaded. Store it somewhere safe (it contains sensitive data).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBusy(false);
    }
  }

  async function requestMigration() {
    setError('');
    setNotice('');
    try {
      await api('/ops', {
        method: 'POST',
        body: {
          type: 'run_migrations',
          reason: 'Run pending DB migrations (requested from Database page)',
        },
      });
      setNotice('Migration request created. A super-admin must approve it under Engineering Ops.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create request.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Database</h1>
          <p className="mt-1 text-sm text-slate-400">
            Migration status, size, and on-demand logical backups.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadBackup}
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? 'Backing up…' : 'Download backup'}
          </button>
          <button
            onClick={load}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-md border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {status && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Connection" value={status.connected ? 'connected' : 'down'} ok={status.connected} />
            <Stat
              label="Pending migrations"
              value={status.hasPendingMigrations ? 'yes' : 'none'}
              ok={!status.hasPendingMigrations}
            />
            <Stat label="DB size" value={status.database.sizePretty} />
            <Stat label="Tables" value={String(status.database.tableCount)} />
          </div>

          {status.hasPendingMigrations && (
            <div className="mt-4 flex items-center justify-between rounded-md border border-amber-900 bg-amber-950 px-4 py-3">
              <span className="text-sm text-amber-200">
                There are pending migrations. Running them is approval-gated.
              </span>
              <button
                onClick={requestMigration}
                className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
              >
                Request migration run
              </button>
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title={`Largest tables`}>
              <Table
                head={['Table', 'Rows', 'Size']}
                rows={tables.map((t) => [t.table, t.rows.toLocaleString(), t.size])}
                empty="No table stats."
              />
            </Panel>
            <Panel title="Recent applied migrations">
              <Table
                head={['Migration', 'When']}
                rows={status.executedMigrations.map((m) => [
                  m.name,
                  m.timestamp,
                ])}
                empty="No migration records (schema may be sync-managed)."
              />
            </Panel>
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-slate-600">
        Backups are a JSON snapshot of the critical tables (orgs, users, billing,
        staff, settings, payments). For full physical backups, use pg_dump from
        your ops runbook.
      </p>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${
          ok === undefined ? 'text-white' : ok ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
      <div className="mb-3 text-sm font-semibold text-white">{title}</div>
      {children}
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: string[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-500">{empty}</div>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-slate-500">
        <tr>
          {head.map((h) => (
            <th key={h} className="pb-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td
                key={j}
                className={`py-2 ${j === 0 ? 'font-mono text-xs text-slate-300' : 'text-slate-400'}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
