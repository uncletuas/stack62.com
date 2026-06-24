import { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import {
  createAnnouncement,
  listAnnouncements,
} from "../lib/admin-api";
import {
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
  shortDate,
} from "../components";

export function Content() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState("in_app");

  const load = useCallback(() => {
    listAnnouncements({}).then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => load(), [load]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return;
    await createAnnouncement({ title: title.trim(), body: body.trim(), channel });
    setTitle("");
    setBody("");
    setComposing(false);
    load();
  };

  return (
    <div>
      <ModuleHeader
        icon={Megaphone}
        title="Content & Communication"
        description="Announcements, templates, and messaging campaigns."
        actions={
          <button
            onClick={() => setComposing((c) => !c)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New announcement
          </button>
        }
      />
      <div className="space-y-6 p-6">
        {composing && (
          <Panel title="New announcement">
            <div className="space-y-3 p-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="h-9 w-full rounded-md border border-app bg-app px-3 text-sm outline-none focus:border-accent"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Message…"
                rows={4}
                className="w-full rounded-md border border-app bg-app px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex items-center gap-2">
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="h-9 rounded-md border border-app bg-app px-2 text-sm"
                >
                  <option value="in_app">In-app</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="push">Push</option>
                </select>
                <button
                  onClick={submit}
                  className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
                >
                  Save draft
                </button>
              </div>
            </div>
          </Panel>
        )}

        <Panel title="Announcements">
          <DataTable
            rows={rows}
            rowKey={(a) => String(a.id)}
            empty="No announcements yet."
            columns={[
              {
                key: "title",
                header: "Title",
                render: (a) => (
                  <span className="font-medium">{String(a.title)}</span>
                ),
              },
              {
                key: "channel",
                header: "Channel",
                render: (a) => <StatusBadge value={String(a.channel)} />,
              },
              {
                key: "status",
                header: "Status",
                render: (a) => <StatusBadge value={String(a.status)} />,
              },
              {
                key: "created",
                header: "Created",
                render: (a) => (
                  <span className="text-app-muted">
                    {shortDate(a.createdAt as string)}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
