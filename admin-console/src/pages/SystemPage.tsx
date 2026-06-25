import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Flags {
  maintenanceMode: boolean;
  readOnlyMode: boolean;
  rateLimitPerMin: number;
  updatedAt: string;
}

export function SystemPage() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rate, setRate] = useState('0');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const f = await api<Flags>('/system/status');
      setFlags(f);
      setRate(String(f.rateLimitPerMin));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load status.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, body: unknown, msg: string) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const f = await api<Flags>(path, { method: 'POST', body });
      setFlags(f);
      setRate(String(f.rateLimitPerMin));
      setNotice(msg);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">System Controls</h1>
      <p className="mt-1 text-sm text-slate-400">
        Emergency runtime levers. Changes apply platform-wide within ~10 seconds,
        no redeploy. The admin console, health checks and payment webhooks stay
        reachable even under maintenance.
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

      {flags && (
        <div className="mt-6 space-y-4">
          <Control
            title="Maintenance mode"
            desc="Take the customer surface offline (HTTP 503). Use for a controlled shutdown during an incident or deploy."
            active={flags.maintenanceMode}
            danger
            busy={busy}
            onToggle={(on) =>
              call('/system/maintenance', { enabled: on }, on ? 'Maintenance mode ON — customers see a 503.' : 'Maintenance mode OFF.')
            }
          />
          <Control
            title="Read-only mode"
            desc="Allow reads but block all customer writes (HTTP 423). Protects data during investigation or migration without a full shutdown."
            active={flags.readOnlyMode}
            busy={busy}
            onToggle={(on) =>
              call('/system/read-only', { enabled: on }, on ? 'Read-only mode ON — writes paused.' : 'Read-only mode OFF.')
            }
          />
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
            <div className="text-sm font-semibold text-white">
              Per-IP rate limit
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Throttle excess traffic: max customer requests per minute per IP.
              0 disables. Current:{' '}
              <span className="text-slate-200">
                {flags.rateLimitPerMin === 0 ? 'disabled' : `${flags.rateLimitPerMin}/min`}
              </span>
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-32 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
              />
              <button
                disabled={busy}
                onClick={() =>
                  call('/system/rate-limit', { perMinute: Number(rate) }, 'Rate limit updated.')
                }
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Apply
              </button>
              <button
                disabled={busy}
                onClick={() => call('/system/rate-limit', { perMinute: 60 }, 'Rate limit set to 60/min.')}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Quick: 60/min
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-600">
            Last refreshed {new Date(flags.updatedAt).toLocaleString()}. For full
            compute hibernation (stopping the server to save cost), use the EC2
            stop command from your ops runbook — these toggles control live
            traffic, not the instance.
          </p>
        </div>
      )}
    </div>
  );
}

function Control({
  title,
  desc,
  active,
  danger,
  busy,
  onToggle,
}: {
  title: string;
  desc: string;
  active: boolean;
  danger?: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-slate-800 bg-slate-950 p-5">
      <div className="pr-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{title}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
              active
                ? danger
                  ? 'bg-red-900 text-red-300'
                  : 'bg-amber-900 text-amber-300'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {active ? 'ON' : 'OFF'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-400">{desc}</p>
      </div>
      <button
        disabled={busy}
        onClick={() => onToggle(!active)}
        className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${
          active
            ? 'border border-slate-700 text-slate-200 hover:bg-slate-800'
            : danger
              ? 'bg-red-700 text-white hover:bg-red-600'
              : 'bg-amber-700 text-white hover:bg-amber-600'
        }`}
      >
        {active ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}
