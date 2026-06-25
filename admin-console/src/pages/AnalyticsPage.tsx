import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { BarChart } from '../components/BarChart';

interface Overview {
  totals: { users: number; organizations: number; activeSubscriptions: number };
  last30Days: { newUsers: number; newOrganizations: number };
  recurring: { mrrCents: number; arrCents: number; currency: string };
  revenue: {
    allTimeMinor: number;
    last30DaysMinor: number;
    currency: string;
    successfulPayments: number;
  };
}
interface Growth {
  users: { date: string; count: number }[];
  organizations: { date: string; count: number }[];
}
interface Revenue {
  monthly: { month: string; currency: string; amountMinor: number }[];
  planDistribution: { tier: string; name: string; activeSubscriptions: number }[];
}
interface Regions {
  usersByCountry: { country: string; count: number }[];
  organizationsByCountry: { country: string; count: number }[];
}

// Paystack/most providers report amounts in minor units (kobo/cents = /100).
function money(minor: number, currency: string): string {
  const major = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString()}`;
  }
}

export function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [regions, setRegions] = useState<Regions | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, g, r, reg] = await Promise.all([
        api<Overview>('/analytics/overview'),
        api<Growth>('/analytics/growth', { query: { days: 90 } }),
        api<Revenue>('/analytics/revenue'),
        api<Regions>('/analytics/regions'),
      ]);
      setOverview(o);
      setGrowth(g);
      setRevenue(r);
      setRegions(reg);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load analytics.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Analytics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Growth, revenue, plan mix and regions across the whole platform.
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
          <Kpi label="Total users" value={overview.totals.users.toLocaleString()} sub={`+${overview.last30Days.newUsers} in 30d`} />
          <Kpi label="Organizations" value={overview.totals.organizations.toLocaleString()} sub={`+${overview.last30Days.newOrganizations} in 30d`} />
          <Kpi
            label="MRR (estimated)"
            value={money(overview.recurring.mrrCents, overview.recurring.currency)}
            sub={`ARR ${money(overview.recurring.arrCents, overview.recurring.currency)}`}
          />
          <Kpi
            label="Revenue collected"
            value={money(overview.revenue.allTimeMinor, overview.revenue.currency)}
            sub={`${money(overview.revenue.last30DaysMinor, overview.revenue.currency)} in 30d`}
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="User signups (90 days)">
          <BarChart
            data={(growth?.users ?? []).map((b) => ({ label: b.date, value: b.count }))}
            color="#6366f1"
          />
        </Card>
        <Card title="New organizations (90 days)">
          <BarChart
            data={(growth?.organizations ?? []).map((b) => ({ label: b.date, value: b.count }))}
            color="#10b981"
          />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Monthly revenue collected (12 months)">
          <BarChart
            data={(revenue?.monthly ?? []).map((m) => ({
              label: m.month,
              value: m.amountMinor / 100,
            }))}
            color="#f59e0b"
            format={(n) =>
              money(n * 100, revenue?.monthly[0]?.currency ?? overview?.revenue.currency ?? 'NGN')
            }
          />
          {(!revenue || revenue.monthly.length === 0) && (
            <p className="mt-2 text-xs text-slate-500">
              No payments recorded yet. Real revenue appears here once Paystack
              starts posting to the webhook.
            </p>
          )}
        </Card>
        <Card title="Active plan distribution">
          <Table
            rows={(revenue?.planDistribution ?? []).map((p) => [
              p.name,
              String(p.activeSubscriptions),
            ])}
            head={['Plan', 'Active subs']}
            empty="No active subscriptions."
          />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Users by region">
          <Table
            rows={(regions?.usersByCountry ?? []).map((r) => [r.country, String(r.count)])}
            head={['Country', 'Users']}
            empty="No data."
          />
        </Card>
        <Card title="Organizations by region">
          <Table
            rows={(regions?.organizationsByCountry ?? []).map((r) => [r.country, String(r.count)])}
            head={['Country', 'Orgs']}
            empty="No data."
          />
        </Card>
      </div>

      <p className="mt-6 text-xs text-slate-600">
        Regions populate from signup country going forward (older accounts show as
        “Unknown”). MRR is estimated from active subscriptions; “Revenue
        collected” is real money from Paystack webhook events.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
      <div className="mb-3 text-sm font-semibold text-white">{title}</div>
      {children}
    </div>
  );
}

function Table({
  rows,
  head,
  empty,
}: {
  rows: string[][];
  head: string[];
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
              <td key={j} className={`py-2 ${j === 0 ? 'text-slate-200' : 'text-slate-400'}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
