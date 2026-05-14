import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { apiRequest } from "../lib/api";

/**
 * Compose-an-email dialog. Calls the existing `POST /v1/emails`
 * endpoint, which uses Resend under the hood. Reachable from:
 *   - the global email-compose action (top-bar profile menu)
 *   - a file's Share menu (pre-populated with attachment context)
 *   - the Coworker (the AI can hand a prefilled compose state to
 *     the user via a custom event — wired in a follow-up)
 */
export function EmailComposer({
  open,
  onClose,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
}: {
  open: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const toRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever the dialog opens with new initial values.
  useEffect(() => {
    if (!open) return;
    setTo(initialTo);
    setSubject(initialSubject);
    setBody(initialBody);
    setError(null);
    setSent(false);
    // Focus the first empty input.
    requestAnimationFrame(() => {
      if (!initialTo) toRef.current?.focus();
    });
  }, [open, initialTo, initialSubject, initialBody]);

  if (!open) return null;

  const recipients = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const canSend =
    recipients.length > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await apiRequest("/v1/emails", {
        method: "POST",
        body: { to: recipients, subject, body },
      });
      setSent(true);
      // Auto-close shortly after a successful send so the modal
      // doesn't linger and the user can keep working.
      window.setTimeout(() => onClose(), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-app bg-app-surface px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-semibold text-app">New email</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4">
          {sent ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-center">
              <p className="text-sm font-semibold text-emerald-700">
                Sent.
              </p>
              <p className="mt-1 text-xs text-emerald-600">
                Delivered to {recipients.length} recipient
                {recipients.length === 1 ? "" : "s"}.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="To">
                <input
                  ref={toRef}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="email@example.com, another@example.com"
                  className="w-full rounded-md border border-app bg-app px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label="Subject">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's this about?"
                  className="w-full rounded-md border border-app bg-app px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label="Body">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message…"
                  rows={8}
                  className="w-full resize-y rounded-md border border-app bg-app px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </Field>
              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-app px-3 py-1.5 text-sm text-app hover:bg-app-hover"
                  disabled={sending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover disabled:opacity-50"
                >
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}
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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-app-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
