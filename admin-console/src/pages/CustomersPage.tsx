import { useState } from 'react';
import { api, ApiError } from '../lib/api';

interface SearchResult {
  organizations: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
  }[];
  users: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    emailVerifiedAt: string | null;
  }[];
}

interface OrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    description: string | null;
    createdAt: string;
  };
  owner: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    emailVerifiedAt: string | null;
  } | null;
  memberCount: number;
  plan: { tier: string; name: string } | null;
  subscription: { status: string; interval: string; seats: number } | null;
  usage: { metric: string; period: string; count: number }[];
  recentActivity: {
    id: string;
    action: string;
    origin: string;
    createdAt: string;
  }[];
}

export function CustomersPage() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      setResults(await api<SearchResult>('/customers/search', { query: { q: term } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openOrg(id: string) {
    setError('');
    setNotice('');
    try {
      setDetail(await api<OrgDetail>(`/customers/organizations/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load org.');
    }
  }

  async function resetPassword(userId: string) {
    setError('');
    setNotice('');
    try {
      const res = await api<{ tempPassword: string }>(
        `/customers/users/${userId}/reset-password`,
        { method: 'POST' },
      );
      setNotice(`Temporary password (share securely): ${res.tempPassword}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed.');
    }
  }

  async function impersonate(userId: string) {
    setError('');
    setNotice('');
    try {
      const res = await api<{ token: string; expiresInSeconds: number }>(
        `/customers/users/${userId}/impersonate`,
        { method: 'POST' },
      );
      await navigator.clipboard?.writeText(res.token).catch(() => {});
      setNotice(
        `Impersonation token copied to clipboard. Expires in ${Math.round(
          res.expiresInSeconds / 60,
        )} min. This action was audited.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impersonation failed.');
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">Customers & Support</h1>
      <p className="mt-1 text-sm text-slate-400">
        Search organizations and users, inspect accounts, and run support actions.
      </p>

      <form onSubmit={search} className="mt-4 flex gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name, slug, email…"
          className="w-80 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
        />
        <button
          disabled={busy}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 break-all rounded-md border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {results?.organizations.length ? (
            <Panel title="Organizations">
              {results.organizations.map((o) => (
                <button
                  key={o.id}
                  onClick={() => openOrg(o.id)}
                  className="flex w-full items-center justify-between border-b border-slate-800 px-1 py-2 text-left text-sm hover:bg-slate-800"
                >
                  <span className="text-slate-200">{o.name}</span>
                  <span className="text-xs text-slate-500">{o.status}</span>
                </button>
              ))}
            </Panel>
          ) : null}

          {results?.users.length ? (
            <Panel title="Users">
              {results.users.map((u) => (
                <div
                  key={u.id}
                  className="border-b border-slate-800 px-1 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-slate-200">{u.email}</span>
                    <span className="text-xs text-slate-500">
                      {u.emailVerifiedAt ? 'verified' : 'unverified'}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    <SmallBtn onClick={() => resetPassword(u.id)}>
                      Reset password
                    </SmallBtn>
                    <SmallBtn onClick={() => impersonate(u.id)}>
                      Impersonate
                    </SmallBtn>
                  </div>
                </div>
              ))}
            </Panel>
          ) : null}
        </div>

        {detail && (
          <Panel title={detail.organization.name}>
            <dl className="space-y-1 text-sm">
              <Row k="Status" v={detail.organization.status} />
              <Row k="Slug" v={detail.organization.slug} />
              <Row
                k="Owner"
                v={detail.owner ? detail.owner.email : 'unknown'}
              />
              <Row k="Members" v={String(detail.memberCount)} />
              <Row
                k="Plan"
                v={
                  detail.plan
                    ? `${detail.plan.name} (${detail.subscription?.status ?? '—'})`
                    : 'none'
                }
              />
            </dl>
            <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">
              Usage
            </div>
            <div className="mt-1 space-y-1 text-sm">
              {detail.usage.length === 0 && (
                <div className="text-slate-500">No usage recorded.</div>
              )}
              {detail.usage.map((u) => (
                <Row
                  key={`${u.metric}-${u.period}`}
                  k={`${u.metric} (${u.period})`}
                  v={String(u.count)}
                />
              ))}
            </div>
            <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">
              Recent activity
            </div>
            <div className="mt-1 max-h-48 space-y-1 overflow-auto text-xs">
              {detail.recentActivity.map((a) => (
                <div key={a.id} className="flex justify-between text-slate-400">
                  <span className="font-mono text-indigo-300">{a.action}</span>
                  <span>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="mb-2 text-sm font-semibold text-white">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-200">{v}</dd>
    </div>
  );
}

function SmallBtn({
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
