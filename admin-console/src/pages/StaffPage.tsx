import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  ROLE_LABELS,
  type PlatformRole,
  type StaffRecord,
} from '../lib/types';

const ROLES: PlatformRole[] = [
  'super_admin',
  'engineer',
  'support_agent',
  'support_lead',
  'billing_ops',
  'security_officer',
  'analyst',
];

export function StaffPage() {
  const { staff: me } = useAuth();
  const canManage = me?.role === 'super_admin';

  const [rows, setRows] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api<StaffRecord[]>('/staff'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Staff & Roles</h1>
          <p className="mt-1 text-sm text-slate-400">
            Platform team accounts. Mutations require the Super Admin role.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {showCreate ? 'Close' : 'New staff'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {showCreate && canManage && (
        <CreateStaffForm
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
          onError={setError}
        />
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">2FA</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  No staff yet.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-slate-200">
                    {s.firstName} {s.lastName}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{s.email}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <select
                        value={s.role}
                        onChange={(e) =>
                          act(() =>
                            api(`/staff/${s.id}/role`, {
                              method: 'POST',
                              body: { role: e.target.value },
                            }),
                          )
                        }
                        className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-300">
                        {ROLE_LABELS[s.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Pill ok={s.twoFactorEnabled}>
                      {s.twoFactorEnabled ? 'enrolled' : 'pending'}
                    </Pill>
                  </td>
                  <td className="px-4 py-3">
                    <Pill ok={s.status === 'active'}>{s.status}</Pill>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          onClick={() =>
                            act(() =>
                              api(`/staff/${s.id}/status`, {
                                method: 'POST',
                                body: {
                                  status:
                                    s.status === 'active'
                                      ? 'suspended'
                                      : 'active',
                                },
                              }),
                            )
                          }
                        >
                          {s.status === 'active' ? 'Suspend' : 'Activate'}
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            act(() =>
                              api(`/staff/${s.id}/reset-2fa`, {
                                method: 'POST',
                              }),
                            )
                          }
                        >
                          Reset 2FA
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            act(() =>
                              api(`/staff/${s.id}/force-password-reset`, {
                                method: 'POST',
                              }),
                            )
                          }
                        >
                          Force PW reset
                        </ActionButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateStaffForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'support_agent' as PlatformRole,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/staff', { method: 'POST', body: form });
      onCreated();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950 p-5 sm:grid-cols-2"
    >
      <Input
        placeholder="First name"
        value={form.firstName}
        onChange={(v) => setForm({ ...form, firstName: v })}
      />
      <Input
        placeholder="Last name"
        value={form.lastName}
        onChange={(v) => setForm({ ...form, lastName: v })}
      />
      <Input
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={(v) => setForm({ ...form, email: v })}
      />
      <Input
        type="password"
        placeholder="Temp password (min 12 chars)"
        value={form.password}
        onChange={(v) => setForm({ ...form, password: v })}
      />
      <select
        value={form.role}
        onChange={(e) =>
          setForm({ ...form, role: e.target.value as PlatformRole })
        }
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button
        disabled={busy}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {busy ? 'Creating…' : 'Create staff'}
      </button>
    </form>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      required
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
    />
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        ok ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'
      }`}
    >
      {children}
    </span>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
    >
      {children}
    </button>
  );
}
