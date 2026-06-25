import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Provider {
  provider: string;
  statuses: Record<string, number>;
  total: number;
}
interface Connection {
  id: string;
  providerKey: string;
  name: string;
  status: string;
  organizationId: string;
  lastCheckedAt: string | null;
  createdAt: string;
}
interface WebhookFeed {
  byStatus: { status: string; count: number }[];
  events: {
    id: string;
    providerKey: string;
    eventType: string;
    status: string;
    organizationId: string | null;
    errorMessage: string | null;
    createdAt: string;
  }[];
}

export function IntegrationsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookFeed | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, c, w] = await Promise.all([
        api<Provider[]>('/integrations/providers'),
        api<Connection[]>('/integrations/connections'),
        api<WebhookFeed>('/integrations/webhooks'),
      ]);
      setProviders(p);
      setConnections(c);
      setWebhooks(w);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load integrations.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">API &amp; Integrations</h1>
      <p className="mt-1 text-sm text-slate-400">
        Third-party connections and webhook activity across all tenants.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Providers
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.length === 0 && (
          <div className="text-sm text-slate-500">No connections yet.</div>
        )}
        {providers.map((p) => (
          <div key={p.provider} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-white">{p.provider}</span>
              <span className="text-sm text-slate-400">{p.total}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
              {Object.entries(p.statuses).map(([s, n]) => (
                <span key={s}>
                  {s}: {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Connections
      </h2>
      <Table
        head={['Provider', 'Name', 'Org', 'Status', 'Created']}
        empty="No connections."
        rows={connections.map((c) => [
          c.providerKey,
          c.name,
          c.organizationId.slice(0, 8),
          <Badge key="s" status={c.status} />,
          new Date(c.createdAt).toLocaleDateString(),
        ])}
      />

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Webhook events{' '}
        {webhooks?.byStatus.map((s) => (
          <span key={s.status} className="ml-2 font-normal text-slate-500">
            {s.status}: {s.count}
          </span>
        ))}
      </h2>
      <Table
        head={['Provider', 'Event', 'Org', 'Status', 'When']}
        empty="No webhook events."
        rows={(webhooks?.events ?? []).map((e) => [
          e.providerKey,
          e.eventType,
          e.organizationId ? e.organizationId.slice(0, 8) : '—',
          <Badge key="s" status={e.status} />,
          new Date(e.createdAt).toLocaleString(),
        ])}
      />
    </div>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-900">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-6 text-center text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className="px-4 py-2.5 text-slate-300">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const cls =
    status === 'failed'
      ? 'bg-red-900 text-red-300'
      : status === 'active' || status === 'processed'
        ? 'bg-emerald-900 text-emerald-300'
        : 'bg-slate-800 text-slate-400';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{status}</span>;
}
