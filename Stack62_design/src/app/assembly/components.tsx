import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, RefreshCw, type LucideIcon } from "lucide-react";

/** Page header for a module screen. */
export function ModuleHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-app px-6 py-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-app">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-app-muted">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A KPI / summary card with optional drill-down on click. */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "bad"
          ? "text-rose-500"
          : "text-app";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`rounded-xl border border-app bg-app-elevated p-4 text-left transition ${
        onClick ? "hover:border-app-strong hover:bg-app-hover" : ""
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-app-faint">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-app-muted">{sub}</div>}
    </Comp>
  );
}

/** Status pill. */
export function StatusBadge({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls =
    ["active", "succeeded", "resolved", "allow", "sent", "closed"].includes(v)
      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
      : ["suspended", "failed", "block", "critical", "past_due", "open"].includes(v)
        ? "text-rose-500 bg-rose-500/10 border-rose-500/20"
        : ["pending", "scheduled", "investigating", "on_hold", "high", "urgent"].includes(v)
          ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
          : "text-app-muted bg-app-hover border-app";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {value}
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** A minimal data table built on the app tokens. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-app-muted">
        {empty ?? "Nothing to show."}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-app text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-app-faint ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-app-soft ${
                onRowClick ? "cursor-pointer hover:bg-app-hover" : ""
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 text-app ${c.className ?? ""}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic async loader with loading skeleton + error/retry. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => live && (setData(d), setLoading(false)))
      .catch((e: { message?: string }) => {
        if (!live) return;
        setError(e?.message ?? "Failed to load.");
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => run(), [run]);
  return { data, loading, error, reload: run };
}

/** Wraps content that depends on an async load, rendering skeleton/error. */
export function AsyncBoundary({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-3 p-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg border border-app bg-app-hover"
          />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <AlertTriangle className="h-8 w-8 text-app-faint" />
        <p className="text-sm text-app-muted">{error}</p>
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

/** Card wrapper for a labelled section within a module page. */
export function Panel({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-app bg-app-elevated">
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-app px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-app">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function relTime(value: string | null | undefined) {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
