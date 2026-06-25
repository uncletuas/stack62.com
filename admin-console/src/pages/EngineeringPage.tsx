import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface OpsRequest {
  id: string;
  type: string;
  status: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  requestedByStaffId: string;
  decidedByStaffId: string | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

const TYPES = [
  { value: 'run_migrations', label: 'Run DB migrations (super-admin approval)' },
  { value: 'rotate_secret', label: 'Rotate a secret' },
  { value: 'custom_trigger', label: 'Custom trigger' },
];

export function EngineeringPage() {
  const { staff } = useAuth();
  const [requests, setRequests] = useState<OpsRequest[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [type, setType] = useState('run_migrations');
  const [reason, setReason] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [triggerName, setTriggerName] = useState('noop');

  const load = useCallback(async () => {
    setError('');
    try {
      setRequests(await api<OpsRequest[]>('/ops'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ops.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    let payload: Record<string, unknown> | undefined;
    if (type === 'rotate_secret') payload = { key: secretKey, value: secretValue };
    if (type === 'custom_trigger') payload = { name: triggerName };
    try {
      await api('/ops', { method: 'POST', body: { type, reason, payload } });
      setNotice('Request created. A different staff member must approve it.');
      setReason('');
      setSecretKey('');
      setSecretValue('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed.');
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setError('');
    setNotice('');
    try {
      const res = await api<OpsRequest>(`/ops/${id}/${action}`, { method: 'POST' });
      setNotice(`Request ${action}d → ${res.status}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${action} failed.`);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">Engineering Ops</h1>
      <p className="mt-1 text-sm text-slate-400">
        Risky actions follow request → approve → execute. You cannot approve your
        own request; migrations need a super-admin approver.
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

      <form
        onSubmit={create}
        className="mt-6 space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-5"
      >
        <div className="text-sm font-semibold text-white">New request</div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {type === 'rotate_secret' && (
          <div className="flex gap-2">
            <input
              placeholder="Secret key (e.g. PAYSTACK_SECRET_KEY)"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
            <input
              type="password"
              placeholder="New value"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </div>
        )}
        {type === 'custom_trigger' && (
          <input
            placeholder="Trigger name (e.g. noop)"
            value={triggerName}
            onChange={(e) => setTriggerName(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          />
        )}
        <input
          placeholder="Reason (recommended)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        />
        <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
          Submit request
        </button>
      </form>

      <h2 className="mt-8 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Requests
      </h2>
      <div className="space-y-3">
        {requests.length === 0 && (
          <div className="text-sm text-slate-500">No requests yet.</div>
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-slate-800 bg-slate-950 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-sm text-indigo-300">{r.type}</span>
                <StatusBadge status={r.status} />
              </div>
              <span className="text-xs text-slate-500">
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>
            {r.reason && (
              <div className="mt-1 text-sm text-slate-400">{r.reason}</div>
            )}
            {r.result && (
              <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 text-xs text-emerald-300">
                {JSON.stringify(r.result, null, 2)}
              </pre>
            )}
            {r.errorMessage && (
              <div className="mt-2 text-xs text-red-400">{r.errorMessage}</div>
            )}
            {r.status === 'pending' && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => decide(r.id, 'approve')}
                  disabled={r.requestedByStaffId === staff?.staffId}
                  title={
                    r.requestedByStaffId === staff?.staffId
                      ? 'You cannot approve your own request'
                      : ''
                  }
                  className="rounded bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-40"
                >
                  Approve & execute
                </button>
                <button
                  onClick={() => decide(r.id, 'reject')}
                  disabled={r.requestedByStaffId === staff?.staffId}
                  className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-900 text-amber-300',
    executed: 'bg-emerald-900 text-emerald-300',
    approved: 'bg-emerald-900 text-emerald-300',
    rejected: 'bg-slate-800 text-slate-400',
    failed: 'bg-red-900 text-red-300',
  };
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
        map[status] ?? 'bg-slate-800 text-slate-400'
      }`}
    >
      {status}
    </span>
  );
}
