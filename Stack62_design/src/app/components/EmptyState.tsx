import type { LucideIcon } from "lucide-react";

/**
 * One-screen "nothing here yet" component. Used across panels and
 * editors so empty states all look the same — an icon-tile in the
 * accent color, a bold title, supporting copy, and an optional CTA.
 *
 * Replaces the dim "No X yet." one-liners that previously made the
 * app look broken when surfaces had no content.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  /** Compact = used inside a narrow sidebar panel. */
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`mx-auto text-center ${
        compact ? "max-w-[220px] p-4" : "max-w-sm p-6"
      }`}
    >
      <div
        className={`mx-auto grid place-items-center rounded-2xl bg-accent-soft text-accent ${
          compact ? "h-9 w-9" : "h-12 w-12"
        }`}
      >
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </div>
      <h3
        className={`mt-3 font-semibold text-app ${
          compact ? "text-sm" : "text-base"
        }`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`mt-1 text-app-muted ${
            compact ? "text-xs leading-relaxed" : "text-sm"
          }`}
        >
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
