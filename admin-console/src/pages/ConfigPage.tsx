import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface SettingView {
  key: string;
  category: string;
  isSecret: boolean;
  description: string | null;
  value: string | null;
  isSet: boolean;
  source: 'override' | 'env' | 'unset';
}

export function ConfigPage() {
  const [rows, setRows] = useState<SettingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api<SettingView[]>('/config'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load config.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(row: SettingView) {
    const value = drafts[row.key];
    if (value === undefined || value === '') return;
    setError('');
    setNotice('');
    try {
      await api('/config', {
        method: 'POST',
        body: { key: row.key, value, isSecret: row.isSecret },
      });
      setNotice(`Saved ${row.key}. Takes effect for services that read it at runtime.`);
      setDrafts((d) => ({ ...d, [row.key]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed.');
    }
  }

  async function clearOverride(key: string) {
    setError('');
    setNotice('');
    try {
      await api(`/config/${encodeURIComponent(key)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clear failed.');
    }
  }

  const categories = [...new Set(rows.map((r) => r.category))].sort();

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">Runtime Config</h1>
      <p className="mt-1 text-sm text-slate-400">
        Override API keys, flags and other variables without a redeploy. A saved
        value overlays the deployed environment. Secrets are write-only and
        stored encrypted.
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

      {loading ? (
        <div className="mt-6 text-slate-500">Loading…</div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {cat}
            </h2>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-800 bg-slate-900">
                  {rows
                    .filter((r) => r.category === cat)
                    .map((row) => (
                      <tr key={row.key}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-mono text-xs text-slate-200">
                            {row.key}
                          </div>
                          {row.description && (
                            <div className="mt-1 text-xs text-slate-500">
                              {row.description}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            <SourceBadge source={row.source} />
                            {row.isSecret && (
                              <span className="text-[10px] uppercase tracking-wide text-amber-400">
                                secret
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-slate-400">
                          {row.isSecret ? (row.isSet ? '••••••••' : '—') : row.value ?? '—'}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <input
                              type={row.isSecret ? 'password' : 'text'}
                              placeholder={row.isSecret ? 'New secret value' : 'New value'}
                              value={drafts[row.key] ?? ''}
                              onChange={(e) =>
                                setDrafts((d) => ({
                                  ...d,
                                  [row.key]: e.target.value,
                                }))
                              }
                              className="w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500"
                            />
                            <button
                              onClick={() => save(row)}
                              className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
                            >
                              Save
                            </button>
                            {row.source === 'override' && (
                              <button
                                onClick={() => clearOverride(row.key)}
                                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SettingView['source'] }) {
  const map = {
    override: 'bg-indigo-900 text-indigo-300',
    env: 'bg-slate-800 text-slate-400',
    unset: 'bg-slate-800 text-slate-600',
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${map[source]}`}>
      {source}
    </span>
  );
}
