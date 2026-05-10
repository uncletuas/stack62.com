import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  fetchRecord,
  updateRecord,
  type RuntimeRecordDetail,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function RecordEditor({ tab }: { tab: EditorTab }) {
  const { appendRunLog, updateTab } = useWorkspace();
  const [detail, setDetail] = useState<RuntimeRecordDetail | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tab.refId) return;
    let live = true;
    void fetchRecord(tab.refId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setData(d.data ?? {});
        setStatus(d.status);
      })
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [tab.refId]);

  if (!detail) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const save = async () => {
    if (!tab.refId) return;
    setSaving(true);
    try {
      await updateRecord(tab.refId, { status, data });
      appendRunLog({ level: "ok", text: "Record saved", source: "records" });
      updateTab(tab.id, { dirty: false });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "records",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-3xl p-6">
        <header className="mb-4 flex items-center gap-3 border-b border-app pb-4">
          <h1 className="text-lg font-semibold">{tab.title}</h1>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              updateTab(tab.id, { dirty: true });
            }}
            className="rounded border border-app bg-app-surface px-2 py-1 text-xs"
          >
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
            <option value="pending">pending</option>
          </select>
          <Button
            onClick={() => void save()}
            disabled={saving}
            size="sm"
            className="ml-auto gap-1"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </header>
        <div className="space-y-3">
          {detail.fields.map((f) => {
            const v = data[f.key];
            const onChange = (next: unknown) => {
              setData((cur) => ({ ...cur, [f.key]: next }));
              updateTab(tab.id, { dirty: true });
            };
            return (
              <label key={f.id} className="block">
                <span className="mb-1 block text-xs font-medium text-app-subtle">
                  {f.name}
                  {f.required && <span className="ml-1 text-rose-400">*</span>}
                  <span className="ml-2 text-[10px] text-app-faint">
                    {f.dataType}
                  </span>
                </span>
                {f.dataType === "longtext" ? (
                  <Textarea
                    value={(v as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    className="min-h-24 border-app bg-app-surface text-white"
                  />
                ) : f.dataType === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(v)}
                    onChange={(e) => onChange(e.target.checked)}
                  />
                ) : f.dataType === "number" ? (
                  <Input
                    type="number"
                    value={(v as number | string) ?? ""}
                    onChange={(e) =>
                      onChange(e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="border-app bg-app-surface"
                  />
                ) : f.dataType === "date" || f.dataType === "datetime" ? (
                  <Input
                    type={f.dataType === "date" ? "date" : "datetime-local"}
                    value={(v as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    className="border-app bg-app-surface"
                  />
                ) : (
                  <Input
                    value={(v as string) ?? ""}
                    onChange={(e) => onChange(e.target.value)}
                    className="border-app bg-app-surface"
                  />
                )}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
