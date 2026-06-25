import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Overview {
  authEvents24h: number;
  openIncidents: number;
  ipRules: { block: number; allow: number };
}
interface EventRow {
  id: string;
  action: string;
  actorUserId: string | null;
  organizationId: string | null;
  origin: string;
  createdAt: string;
}
interface IpRule {
  id: string;
  cidr: string;
  kind: string;
  reason: string | null;
  createdAt: string;
}
interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
}

export function SecurityPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [rules, setRules] = useState<IpRule[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState('');
  const [cidr, setCidr] = useState('');
  const [kind, setKind] = useState('block');
  const [incidentTitle, setIncidentTitle] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, e, r, i] = await Promise.all([
        api<Overview>('/security/overview'),
        api<EventRow[]>('/security/events'),
        api<IpRule[]>('/security/ip-rules'),
        api<Incident[]>('/security/incidents'),
      ]);
      setOverview(o);
      setEvents(e);
      setRules(r);
      setIncidents(i);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load security data.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!cidr.trim()) return;
    try {
      await api('/security/ip-rules', { method: 'POST', body: { cidr: cidr.trim(), kind } });
      setCidr('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add rule failed.');
    }
  }

  async function delRule(id: string) {
    await api(`/security/ip-rules/${id}`, { method: 'DELETE' }).catch(() => {});
    await load();
  }

  async function addIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!incidentTitle.trim()) return;
    await api('/security/incidents', { method: 'POST', body: { title: incidentTitle.trim() } }).catch(() => {});
    setIncidentTitle('');
    await load();
  }

  async function closeIncident(id: string) {
    await api(`/security/incidents/${id}/status`, { method: 'POST', body: { status: 'closed' } }).catch(() => {});
    await load();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">Security Center</h1>
      <p className="mt-1 text-sm text-slate-400">
        Authentication activity, IP allow/block rules, and incident response.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Auth events (24h)" value={overview?.authEvents24h ?? 0} />
        <Stat label="Open incidents" value={overview?.openIncidents ?? 0} tone="warn" />
        <Stat label="Block rules" value={overview?.ipRules.block ?? 0} />
        <Stat label="Allow rules" value={overview?.ipRules.allow ?? 0} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="IP rules">
          <form onSubmit={addRule} className="mb-3 flex gap-2">
            <input
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="CIDR or IP (e.g. 1.2.3.4/32)"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-white"
            >
              <option value="block">Block</option>
              <option value="allow">Allow</option>
            </select>
            <button className="rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">
              Add
            </button>
          </form>
          {rules.length === 0 ? (
            <Empty>No IP rules.</Empty>
          ) : (
            rules.map((r) => (
              <Line key={r.id}>
                <span className="font-mono text-slate-200">{r.cidr}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      r.kind === 'block'
                        ? 'bg-red-900 text-red-300'
                        : 'bg-emerald-900 text-emerald-300'
                    }`}
                  >
                    {r.kind}
                  </span>
                  <button
                    onClick={() => delRule(r.id)}
                    className="text-xs text-slate-500 hover:text-red-300"
                  >
                    remove
                  </button>
                </span>
              </Line>
            ))
          )}
        </Card>

        <Card title="Incidents">
          <form onSubmit={addIncident} className="mb-3 flex gap-2">
            <input
              value={incidentTitle}
              onChange={(e) => setIncidentTitle(e.target.value)}
              placeholder="New incident title…"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500"
            />
            <button className="rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">
              Open
            </button>
          </form>
          {incidents.length === 0 ? (
            <Empty>No incidents. All clear.</Empty>
          ) : (
            incidents.map((i) => (
              <Line key={i.id}>
                <span className="text-slate-200">{i.title}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    {i.status}
                  </span>
                  {i.status !== 'closed' && (
                    <button
                      onClick={() => closeIncident(i.id)}
                      className="text-xs text-slate-500 hover:text-emerald-300"
                    >
                      close
                    </button>
                  )}
                </span>
              </Line>
            ))
          )}
        </Card>
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Recent authentication events
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Origin</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No authentication events recorded.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 font-mono text-indigo-300">{e.action}</td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {e.actorUserId ? e.actorUserId.slice(0, 8) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{e.origin}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(e.createdAt).toLocaleString()}
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
  tone?: 'warn';
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === 'warn' ? 'text-amber-400' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{title}</div>
      {children}
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-1.5 text-sm last:border-0">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-slate-500">{children}</div>;
}
