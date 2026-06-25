import { useEffect, useRef, useState } from "react";
import { HardDrive, Loader2, Mail, Paperclip, Plug, X } from "lucide-react";
import { useAppContext } from "../context/app-context";
import { AttachmentPicker } from "../components/AttachmentPicker";
import {
  fetchIntegrationConnections,
  listFiles,
  sendIntegrationEmail,
  uploadFile,
} from "../lib/resources";

interface EmailAttachment {
  id: string;
  filename: string;
  size: number;
  fileId: string | null;
  uploading: boolean;
  error: string | null;
}

function prettyBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
const EMAIL_PROVIDER_KEYS = ["google-workspace", "smtp-email", "resend"];

/**
 * Compose-an-email dialog. Sends through the org's OWN connected mailbox
 * via `POST /integrations/email/send` (Gmail OAuth or SMTP). If no mailbox
 * is connected it shows a "Connect your email" call-to-action instead of the
 * send form. Reachable from:
 *   - the global email-compose action (top-bar profile menu / command palette)
 *   - a file's Share menu (pre-populated with attachment context)
 *   - the Coworker (prefilled compose state via a custom event)
 */
export function EmailComposer({
  open,
  onClose,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
  initialAttachmentFileIds = [],
}: {
  open: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  initialAttachmentFileIds?: string[];
}) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  // null = still checking whether a mailbox is connected.
  const [emailConnected, setEmailConnected] = useState<boolean | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever the dialog opens with new initial values.
  useEffect(() => {
    if (!open) return;
    setTo(initialTo);
    setSubject(initialSubject);
    setBody(initialBody);
    setError(null);
    setSent(false);
    // Seed any pre-attached files (e.g. shared from the Files page). Names are
    // resolved from the library so the chips read nicely; the send only needs ids.
    if (initialAttachmentFileIds.length && currentOrganization) {
      setAttachments(
        initialAttachmentFileIds.map((fileId) => ({
          id: `a-${fileId}`,
          filename: "Attachment",
          size: 0,
          fileId,
          uploading: false,
          error: null,
        })),
      );
      listFiles({ organizationId: currentOrganization.id })
        .then((all) => {
          setAttachments((cur) =>
            cur.map((a) => {
              const match = all.find((f) => f.id === a.fileId);
              return match
                ? { ...a, filename: match.filename, size: Number(match.size) || 0 }
                : a;
            }),
          );
        })
        .catch(() => undefined);
    } else {
      setAttachments([]);
    }
    // Focus the first empty input.
    requestAnimationFrame(() => {
      if (!initialTo) toRef.current?.focus();
    });
  }, [open, initialTo, initialSubject, initialBody]);

  // Check for a connected mailbox each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (!currentOrganization) {
      setEmailConnected(false);
      return;
    }
    let cancelled = false;
    setEmailConnected(null);
    fetchIntegrationConnections({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    })
      .then((rows) => {
        if (cancelled) return;
        setEmailConnected(
          rows.some(
            (c) =>
              EMAIL_PROVIDER_KEYS.includes(c.providerKey) &&
              c.status === "active",
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setEmailConnected(true); // don't block on a check failure
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentOrganization?.id, currentWorkspace?.id]);

  // Once the user connects a mailbox via the wizard, flip to the send form.
  useEffect(() => {
    const onConnected = () => setEmailConnected(true);
    window.addEventListener("stack62:email-connected", onConnected);
    return () =>
      window.removeEventListener("stack62:email-connected", onConnected);
  }, []);

  if (!open) return null;

  const goConnect = () => {
    window.dispatchEvent(new CustomEvent("stack62:open-email-connect"));
  };

  const recipients = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const uploadsBusy = attachments.some((a) => a.uploading);
  const canSend =
    recipients.length > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending &&
    !uploadsBusy;

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !currentOrganization) return;
    const items: EmailAttachment[] = Array.from(files).map((file) => ({
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: file.name,
      size: file.size,
      fileId: null,
      uploading: true,
      error: null,
    }));
    setAttachments((cur) => [...cur, ...items]);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      try {
        const stored = await uploadFile({
          file: files[i],
          organizationId: currentOrganization.id,
          workspaceId: currentWorkspace?.id,
          scope: "attachment",
        });
        setAttachments((cur) =>
          cur.map((a) =>
            a.id === item.id ? { ...a, uploading: false, fileId: stored.id } : a,
          ),
        );
      } catch (err) {
        setAttachments((cur) =>
          cur.map((a) =>
            a.id === item.id
              ? {
                  ...a,
                  uploading: false,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : a,
          ),
        );
      }
    }
  };

  const send = async () => {
    if (!canSend || !currentOrganization) return;
    setSending(true);
    setError(null);
    try {
      const attachmentFileIds = attachments
        .filter((a) => a.fileId && !a.error)
        .map((a) => a.fileId as string);
      await sendIntegrationEmail({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        to: recipients,
        subject,
        text: body,
        attachmentFileIds: attachmentFileIds.length
          ? attachmentFileIds
          : undefined,
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
            onClick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent("stack62:open-email-inbox"));
            }}
            className="ml-auto rounded-md px-2 py-1 text-xs text-app-muted hover:bg-app-hover hover:text-app"
          >
            Inbox
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4">
          {emailConnected === false ? (
            <div className="rounded-md border border-app bg-app-surface p-5 text-center">
              <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent">
                <Mail className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-app">
                Connect your email first
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-app-muted">
                To send email, connect your own mailbox — sign in with Google
                or add an SMTP account. Your coworker will then be able to send
                email on your behalf too.
              </p>
              <button
                type="button"
                onClick={goConnect}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover"
              >
                <Plug className="h-3.5 w-3.5" />
                Connect email
              </button>
            </div>
          ) : sent ? (
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
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
                        a.error
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : a.uploading
                            ? "border-app bg-app text-app-muted"
                            : "border-accent/50 bg-accent-soft text-accent"
                      }`}
                      title={a.error ?? `${a.filename} · ${prettyBytes(a.size)}`}
                    >
                      {a.uploading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Paperclip className="h-3 w-3" />
                      )}
                      <span className="max-w-[160px] truncate">{a.filename}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttachments((cur) =>
                            cur.filter((x) => x.id !== a.id),
                          )
                        }
                        className="rounded-full p-0.5 hover:bg-app-hover"
                        title="Remove"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {error && (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void onPickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-md border border-app px-3 py-1.5 text-sm text-app-muted hover:bg-app-hover hover:text-app"
                  title="Attach files from this device"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach
                </button>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="flex items-center gap-1.5 rounded-md border border-app px-3 py-1.5 text-sm text-app-muted hover:bg-app-hover hover:text-app"
                  title="Attach from your Stack62 library or Google Drive"
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  Library / Drive
                </button>
                <div className="flex-1" />
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

      {currentOrganization && (
        <AttachmentPicker
          organizationId={currentOrganization.id}
          workspaceId={currentWorkspace?.id}
          open={showPicker}
          onClose={() => setShowPicker(false)}
          onPicked={(file) =>
            setAttachments((cur) => [
              ...cur,
              {
                id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                filename: file.filename,
                size: Number(file.size) || 0,
                fileId: file.id,
                uploading: false,
                error: null,
              },
            ])
          }
          title="Attach to email"
        />
      )}
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
