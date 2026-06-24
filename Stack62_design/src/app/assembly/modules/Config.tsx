import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, RotateCcw } from "lucide-react";
import {
  listConfig,
  rollbackConfig,
  upsertConfig,
  type PlatformConfig,
} from "../lib/admin-api";
import {
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
} from "../components";

const CATEGORIES = [
  "general",
  "url",
  "feature_flag",
  "smtp",
  "storage",
  "payment",
  "ai_provider",
];

export function Config() {
  const [rows, setRows] = useState<PlatformConfig[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("general");
  const [isSecret, setIsSecret] = useState(false);

  const load = useCallback(() => {
    listConfig().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(() => load(), [load]);

  const submit = async () => {
    if (!key.trim()) return;
    await upsertConfig({ key: key.trim(), value, category, isSecret });
    setKey("");
    setValue("");
    setIsSecret(false);
    setAdding(false);
    load();
  };

  return (
    <div>
      <ModuleHeader
        icon={FileText}
        title="URL & Configuration"
        description="Versioned platform settings with one-step rollback."
        actions={
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> Set value
          </button>
        }
      />
      <div className="space-y-6 p-6">
        {adding && (
          <Panel title="Create / update config">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="key (e.g. smtp.host)"
                className="h-9 rounded-md border border-app bg-app px-3 text-sm outline-none focus:border-accent"
              />
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="value"
                className="h-9 rounded-md border border-app bg-app px-3 text-sm outline-none focus:border-accent"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-md border border-app bg-app px-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-app-muted">
                <input
                  type="checkbox"
                  checked={isSecret}
                  onChange={(e) => setIsSecret(e.target.checked)}
                />
                Secret (masked in responses)
              </label>
              <button
                onClick={submit}
                className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover sm:col-span-2"
              >
                Save
              </button>
            </div>
          </Panel>
        )}

        <Panel title="Configuration values">
          <DataTable
            rows={rows}
            rowKey={(c) => c.id}
            empty="No configuration set yet."
            columns={[
              {
                key: "key",
                header: "Key",
                render: (c) => <span className="font-medium">{c.key}</span>,
              },
              {
                key: "value",
                header: "Value",
                render: (c) => (
                  <span className="font-mono text-xs text-app-muted">
                    {c.value ?? "—"}
                  </span>
                ),
              },
              {
                key: "category",
                header: "Category",
                render: (c) => <StatusBadge value={c.category} />,
              },
              { key: "version", header: "v", render: (c) => c.version },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (c) => (
                  <button
                    onClick={async () => {
                      await rollbackConfig(c.key);
                      load();
                    }}
                    title="Roll back to previous value"
                    className="inline-flex items-center gap-1 rounded-md border border-app px-2 py-1 text-[11px] font-medium text-app-muted hover:bg-app-hover"
                  >
                    <RotateCcw className="h-3 w-3" /> Rollback
                  </button>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
