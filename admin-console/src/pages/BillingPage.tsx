import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Plan {
  id: string;
  tier: string;
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  currency: string;
  monthlyAiRequests: number;
  maxMembers: number;
  maxActiveSystems: number;
  isPublished: boolean;
  customizedAt: string | null;
}

interface Subscription {
  id: string;
  organizationId: string;
  planTier: string;
  planName: string;
  status: string;
  interval: string;
  seats: number;
}

export function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<Plan>>>({});

  const load = useCallback(async () => {
    setError('');
    try {
      const [p, s] = await Promise.all([
        api<Plan[]>('/billing/plans'),
        api<Subscription[]>('/billing/subscriptions'),
      ]);
      setPlans(p);
      setSubs(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load billing.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePlan(plan: Plan) {
    const edit = edits[plan.id];
    if (!edit) return;
    setError('');
    setNotice('');
    try {
      await api(`/billing/plans/${plan.id}`, { method: 'POST', body: edit });
      setNotice(`Updated ${plan.name}. Future signups use the new values immediately.`);
      setEdits((e) => ({ ...e, [plan.id]: {} }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.');
    }
  }

  function field(plan: Plan, key: keyof Plan): number {
    const edit = edits[plan.id]?.[key];
    return (edit as number) ?? (plan[key] as number);
  }

  function setField(planId: string, key: keyof Plan, value: number) {
    setEdits((e) => ({ ...e, [planId]: { ...e[planId], [key]: value } }));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">Billing & Plans</h1>
      <p className="mt-1 text-sm text-slate-400">
        Edit subscription amounts and limits without code changes. Edited plans
        are pinned (the boot-time seed won't revert them).
      </p>

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

      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Plans
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Monthly ({'¢'})</th>
              <th className="px-4 py-3">Yearly ({'¢'})</th>
              <th className="px-4 py-3">AI/mo</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Systems</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="text-slate-200">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.tier}
                    {p.customizedAt ? ' · pinned' : ''}
                  </div>
                </td>
                <NumCell value={field(p, 'monthlyPriceCents')} onChange={(v) => setField(p.id, 'monthlyPriceCents', v)} />
                <NumCell value={field(p, 'yearlyPriceCents')} onChange={(v) => setField(p.id, 'yearlyPriceCents', v)} />
                <NumCell value={field(p, 'monthlyAiRequests')} onChange={(v) => setField(p.id, 'monthlyAiRequests', v)} />
                <NumCell value={field(p, 'maxMembers')} onChange={(v) => setField(p.id, 'maxMembers', v)} />
                <NumCell value={field(p, 'maxActiveSystems')} onChange={(v) => setField(p.id, 'maxActiveSystems', v)} />
                <td className="px-4 py-3">
                  <button
                    onClick={() => savePlan(p)}
                    className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Subscriptions ({subs.length})
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Interval</th>
              <th className="px-4 py-3">Seats</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {subs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No subscriptions.
                </td>
              </tr>
            ) : (
              subs.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {s.organizationId}
                  </td>
                  <td className="px-4 py-3 text-slate-200">{s.planName}</td>
                  <td className="px-4 py-3 text-slate-400">{s.status}</td>
                  <td className="px-4 py-3 text-slate-400">{s.interval}</td>
                  <td className="px-4 py-3 text-slate-400">{s.seats}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NumCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <td className="px-4 py-3">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
      />
    </td>
  );
}
