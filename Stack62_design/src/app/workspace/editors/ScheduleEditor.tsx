import { useEffect, useState } from "react";
import { Calendar, Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { useAppContext } from "../../context/app-context";
import {
  fetchSchedules,
  deleteSchedule,
  updateSchedule,
  type Schedule,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { DraftPreview } from "./DraftPreview";

const KINDS = ["meeting", "milestone", "deadline", "task", "shift", "reminder"];
const STATUSES = ["scheduled", "active", "completed", "cancelled"];

const localDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

export function ScheduleEditor({ tab }: { tab: EditorTab }) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, updateTab } = useWorkspace();
  const [draft, setDraft] = useState({
    title: "",
    kind: "meeting",
    status: "scheduled",
    startsAt: "",
    endsAt: "",
    recurrenceRule: "",
    metadata: "{}",
  });
  const [existing, setExisting] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tab.refId || !currentOrganization) return setExisting(null);
    let live = true;
    void fetchSchedules({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((all) => live && setExisting(all.find((s) => s.id === tab.refId) ?? null))
      .catch(() => live && setExisting(null));
    return () => {
      live = false;
    };
  }, [tab.refId, currentOrganization, currentWorkspace?.id]);

  useEffect(() => {
    if (!existing) return;
    setDraft({
      title: existing.title,
      kind: existing.kind,
      status: existing.status,
      startsAt: localDate(existing.startsAt),
      endsAt: localDate(existing.endsAt),
      recurrenceRule: existing.recurrenceRule ?? "",
      metadata: JSON.stringify(existing.metadata ?? {}, null, 2),
    });
  }, [existing]);

  if (!tab.refId) {
    return <DraftPreview icon={Calendar} title="Ask the coworker to schedule this" />;
  }

  const save = async () => {
    if (!currentOrganization || !currentWorkspace || !draft.title || !draft.startsAt)
      return;
    setBusy(true);
    try {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = draft.metadata ? JSON.parse(draft.metadata) : {};
      } catch {
        appendRunLog({
          level: "warn",
          text: "Invalid metadata JSON — saved as empty object",
          source: "schedule",
        });
      }
      const payload = {
        title: draft.title,
        kind: draft.kind,
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
        recurrenceRule: draft.recurrenceRule || null,
        metadata,
      };
      if (existing) {
        const next = await updateSchedule(existing.id, {
          ...payload,
          status: draft.status,
        });
        setExisting(next);
        updateTab(tab.id, { title: next.title, dirty: false });
        appendRunLog({
          level: "ok",
          text: `Schedule "${next.title}" updated`,
          source: "schedule",
        });
      }
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "schedule",
      });
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft((cur) => ({ ...cur, [key]: value }));
    updateTab(tab.id, { dirty: true });
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      const deleted = await deleteSchedule(existing.id);
      setExisting(deleted);
      updateTab(tab.id, { title: deleted.title, dirty: false });
      appendRunLog({
        level: "ok",
        text: `Deleted schedule "${deleted.title}"`,
        source: "schedule",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Delete failed: ${(err as Error).message}`,
        source: "schedule",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-3xl p-6">
        <header className="flex items-center gap-3 border-b border-app pb-3">
          <Calendar className="h-5 w-5 text-sky-400" />
          <h1 className="text-lg font-semibold">
            {existing ? existing.title : tab.title}
          </h1>
          <Button
            onClick={() => void save()}
            disabled={busy || !draft.title || !draft.startsAt}
            size="sm"
            className="ml-auto gap-1"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
          {existing && (
            <Button
              onClick={() => void remove()}
              disabled={busy}
              size="sm"
              variant="outline"
              className="gap-1 border-rose-900/70 text-rose-200 hover:bg-rose-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
        </header>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Kind">
            <select
              value={draft.kind}
              onChange={(e) => set("kind", e.target.value)}
              className="w-full rounded border border-app bg-app-surface p-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starts">
            <Input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Ends">
            <Input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Recurrence (RRULE)">
            <Input
              value={draft.recurrenceRule}
              onChange={(e) => set("recurrenceRule", e.target.value)}
              placeholder="e.g. FREQ=WEEKLY;BYDAY=MO"
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
              className="w-full rounded border border-app bg-app-surface p-2 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Metadata (JSON)">
            <Textarea
              value={draft.metadata}
              onChange={(e) => set("metadata", e.target.value)}
              className="min-h-32 border-app bg-app-surface font-mono text-xs text-emerald-200"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-app-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
