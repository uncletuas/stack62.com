import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  recipientsCount: number;
  engagedCount: number;
  createdAt: string;
}

export function ContentPage() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState('in_app');

  const load = useCallback(async () => {
    setError('');
    try {
      setRows(await api<Announcement[]>('/content/announcements'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/content/announcements', {
        method: 'POST',
        body: { title, body, channel },
      });
      setTitle('');
      setBody('');
      setShow(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed.');
    }
  }

  async function setStatus(id: string, status: string) {
    setError('');
    try {
      await api(`/content/announcements/${id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Content &amp; Communication</h1>
          <p className="mt-1 text-sm text-slate-400">
            Platform announcements and messaging campaigns.
          </p>
        </div>
        <button
          onClick={() => setShow((v) => !v)}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {show ? 'Close' : 'New announcement'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {show && (
        <form
          onSubmit={create}
          className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-5"
        >
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
          <textarea
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message…"
            rows={4}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
          <div className="flex items-center gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="in_app">In-app</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="push">Push</option>
            </select>
            <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Save draft
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No announcements yet.
                </td>
              </tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 text-slate-200">{a.title}</td>
                  <td className="px-4 py-2.5 text-slate-400">{a.channel}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.status !== 'sent' && a.status !== 'archived' && (
                      <button
                        onClick={() => setStatus(a.id, 'sent')}
                        className="rounded border border-slate-700 px-2 py-1 text-xs text-emerald-300 hover:bg-slate-800"
                      >
                        Mark sent
                      </button>
                    )}
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
