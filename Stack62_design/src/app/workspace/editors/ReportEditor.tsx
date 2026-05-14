import { useEffect, useMemo, useState } from "react";
import { FileText, LineChart, Loader2, Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  fetchReport,
  saveReportAsDocument,
  updateReport,
  type Report,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";
import { DraftPreview } from "./DraftPreview";

export function ReportEditor({ tab }: { tab: EditorTab }) {
  const { appendRunLog, navigate, updateTab } = useWorkspace();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    status: "active",
    data: "{}",
  });

  useEffect(() => {
    if (!tab.refId) {
      setReport(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void fetchReport(tab.refId)
      .then((next) => {
        if (!live) return;
        setReport(next);
        setDraft({
          title: next.title,
          summary: next.summary ?? "",
          status: next.status,
          data: JSON.stringify(next.data ?? {}, null, 2),
        });
      })
      .catch(() => live && setReport(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [tab.refId]);

  const metrics = useMemo(() => {
    if (!report?.data || typeof report.data !== "object") return [];
    return Object.entries(report.data)
      .filter(([, value]) => typeof value === "number" || typeof value === "string")
      .slice(0, 8);
  }, [report]);

  if (!tab.refId) {
    return <DraftPreview icon={LineChart} title="Ask the coworker to generate this report" />;
  }

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft((cur) => ({ ...cur, [key]: value }));
    updateTab(tab.id, { dirty: true });
  };

  const save = async () => {
    if (!report) return;
    setBusy(true);
    try {
      let data: Record<string, unknown> = {};
      try {
        data = draft.data ? JSON.parse(draft.data) : {};
      } catch {
        appendRunLog({
          level: "warn",
          text: "Invalid report data JSON saved as an empty object",
          source: "report",
        });
      }
      const next = await updateReport(report.id, {
        title: draft.title,
        summary: draft.summary,
        status: draft.status,
        data,
      });
      setReport(next);
      updateTab(tab.id, { title: next.title, dirty: false });
      appendRunLog({
        level: "ok",
        text: `Report "${next.title}" updated`,
        source: "report",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "report",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveDocument = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const doc = await saveReportAsDocument(report.id);
      appendRunLog({
        level: "ok",
        text: `Saved report as document "${doc.title}"`,
        source: "report",
      });
      navigate({ kind: "document", title: doc.title, refId: doc.id });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Document save failed: ${(err as Error).message}`,
        source: "report",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="grid h-full place-items-center bg-app text-app-faint">
        Report not found.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-5xl p-6">
        <header className="flex items-center gap-3 border-b border-app pb-3">
          <LineChart className="h-5 w-5 text-accent" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{report.title}</h1>
            <p className="text-xs text-app-faint">
              {report.sourceType} · {report.status} · {new Date(report.updatedAt).toLocaleString()}
            </p>
          </div>
          <Button
            onClick={() => void save()}
            disabled={busy || !draft.title}
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
          <Button
            onClick={() => void saveDocument()}
            disabled={busy}
            size="sm"
            variant="outline"
            className="gap-1"
          >
            <FileText className="h-3.5 w-3.5" />
            Document
          </Button>
        </header>

        {metrics.length > 0 && (
          <section className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map(([key, value]) => (
              <div
                key={key}
                className="rounded-lg border border-app bg-app-elevated/35 px-3 py-2"
              >
                <p className="truncate text-[11px] uppercase tracking-wider text-app-faint">
                  {key}
                </p>
                <p className="mt-1 truncate text-lg font-semibold text-app">
                  {String(value)}
                </p>
              </div>
            ))}
          </section>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Status">
            <Input
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
              className="border-app bg-app-surface"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Summary">
            <Textarea
              value={draft.summary}
              onChange={(e) => set("summary", e.target.value)}
              className="min-h-32 border-app bg-app-surface text-sm"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Data (JSON)">
            <Textarea
              value={draft.data}
              onChange={(e) => set("data", e.target.value)}
              className="min-h-56 border-app bg-app-surface font-mono text-xs text-emerald-200"
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
