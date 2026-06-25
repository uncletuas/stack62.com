import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  Mail,
  Plug,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAppContext } from "../context/app-context";
import {
  createIntegrationConnection,
  fetchIntegrationProvidersStatus,
  googleOAuthUrl,
  verifyIntegrationConnection,
  type IntegrationProviderStatus,
} from "../lib/resources";

/**
 * Guided "Connect your email" wizard. Replaces the generic marketplace for
 * email: the user picks their provider, then either signs in with Google
 * (OAuth) or fills a pre-filled SMTP/IMAP form with provider-specific guidance.
 * Opened anywhere via the `stack62:open-email-connect` event.
 */
type ProviderKey = "gmail" | "outlook" | "yahoo" | "zoho" | "other";

interface Preset {
  key: ProviderKey;
  name: string;
  blurb: string;
  oauth?: boolean;
  smtpHost?: string;
  smtpPort?: string;
  imapHost?: string;
  imapPort?: string;
  tip?: string;
  helpUrl?: string;
}

const PRESETS: Preset[] = [
  {
    key: "gmail",
    name: "Gmail / Google Workspace",
    blurb: "Sign in with Google — the quickest and most reliable option.",
    oauth: true,
  },
  {
    key: "outlook",
    name: "Outlook / Microsoft 365",
    blurb: "Connect an outlook.com, hotmail.com, or Microsoft 365 mailbox.",
    smtpHost: "smtp.office365.com",
    smtpPort: "587",
    imapHost: "outlook.office365.com",
    imapPort: "993",
    tip: "If your account uses 2-step verification, create an app password and use it below.",
    helpUrl: "https://support.microsoft.com/account-billing/app-passwords",
  },
  {
    key: "yahoo",
    name: "Yahoo Mail",
    blurb: "Connect a Yahoo mailbox.",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: "465",
    imapHost: "imap.mail.yahoo.com",
    imapPort: "993",
    tip: "Yahoo requires an app password — create one under Account Security → Generate app password.",
    helpUrl: "https://help.yahoo.com/kb/SLN15241.html",
  },
  {
    key: "zoho",
    name: "Zoho Mail",
    blurb: "Connect a Zoho mailbox or custom domain on Zoho.",
    smtpHost: "smtp.zoho.com",
    smtpPort: "465",
    imapHost: "imap.zoho.com",
    imapPort: "993",
    tip: "If 2FA is on, generate an app-specific password in Zoho settings.",
  },
  {
    key: "other",
    name: "Other email (custom SMTP/IMAP)",
    blurb: "Any other provider or business mailbox — enter the server details.",
    smtpHost: "",
    smtpPort: "587",
    imapHost: "",
    imapPort: "993",
    tip: "Find your provider's outgoing (SMTP) and incoming (IMAP) server names and ports — usually in their help docs.",
  },
];

export function EmailConnectDialog() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [status, setStatus] = useState<IntegrationProviderStatus[]>([]);

  useEffect(() => {
    const handler = () => {
      setPreset(null);
      setOpen(true);
    };
    window.addEventListener("stack62:open-email-connect", handler);
    return () =>
      window.removeEventListener("stack62:open-email-connect", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchIntegrationProvidersStatus()
      .then(setStatus)
      .catch(() => setStatus([]));
  }, [open]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setPreset(null);
  };

  const onConnected = () => {
    window.dispatchEvent(new CustomEvent("stack62:email-connected"));
    close();
    // Connecting a mailbox is a settings action — it shouldn't yank the
    // user into the inbox tab. They can open the inbox themselves later.
  };

  const googleStatus = status.find((s) => s.providerKey === "google-workspace");
  const googleUnconfigured = googleStatus ? !googleStatus.configured : false;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-app bg-app-surface px-4 py-3">
          {preset && (
            <button
              type="button"
              onClick={() => setPreset(null)}
              className="rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app"
              title="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-semibold text-app">
            {preset ? `Connect ${preset.name}` : "Connect your email"}
          </h2>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[72vh] overflow-y-auto p-4">
          {!preset ? (
            <ChooseProvider onPick={setPreset} googleUnconfigured={googleUnconfigured} />
          ) : preset.oauth ? (
            <GmailStep
              unconfigured={googleUnconfigured}
              missing={googleStatus?.missing ?? []}
              orgId={currentOrganization?.id}
              workspaceId={currentWorkspace?.id}
              onConnected={onConnected}
            />
          ) : (
            <SmtpStep
              preset={preset}
              orgId={currentOrganization?.id}
              workspaceId={currentWorkspace?.id}
              onConnected={onConnected}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ChooseProvider({
  onPick,
  googleUnconfigured,
}: {
  onPick: (p: Preset) => void;
  googleUnconfigured: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="mb-2 text-xs text-app-muted">
        Choose your email provider. Your coworker will then be able to send and
        read email from your own mailbox.
      </p>
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPick(p)}
          className="flex w-full items-center gap-3 rounded-lg border border-app bg-app-surface px-3 py-2.5 text-left hover:border-accent hover:bg-app-hover"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-app-hover text-app-muted">
            <Mail className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-app">{p.name}</span>
              {p.key === "gmail" && (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  Recommended
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-app-faint">
              {p.oauth && googleUnconfigured
                ? "Sign-in not configured by your operator yet"
                : p.blurb}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function GmailStep({
  unconfigured,
  missing,
  orgId,
  workspaceId,
  onConnected,
}: {
  unconfigured: boolean;
  missing: string[];
  orgId?: string;
  workspaceId?: string;
  onConnected: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "stack62.integration.connected") return;
      onConnected();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onConnected]);

  const start = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/google`;
      const result = await googleOAuthUrl({
        organizationId: orgId,
        workspaceId,
        redirectUri,
      });
      window.open(result.url, "stack62_email_oauth", "width=720,height=760");
      setWaiting(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (unconfigured) {
    return (
      <div className="rounded-lg border border-amber-300/40 bg-amber-50/10 p-4 text-sm">
        <p className="font-medium text-app">Google sign-in isn’t set up yet</p>
        <p className="mt-1 text-xs text-app-muted">
          Your Stack62 operator needs to configure Google sign-in
          {missing.length > 0 ? ` (${missing.join(", ")})` : ""}. Until then you
          can connect any mailbox with SMTP/IMAP instead — go back and choose
          “Other email”.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-2 text-xs text-app-muted">
        <li>1. Click “Sign in with Google”.</li>
        <li>2. Choose your account and approve access to Gmail.</li>
        <li>3. You’ll come straight back here — that’s it.</li>
      </ol>
      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      <Button onClick={() => void start()} disabled={busy} className="w-full gap-2">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plug className="h-4 w-4" />
        )}
        Sign in with Google
      </Button>
      {waiting && (
        <p className="text-center text-xs text-app-faint">
          Waiting for you to finish in the Google window…
        </p>
      )}
    </div>
  );
}

function SmtpStep({
  preset,
  orgId,
  workspaceId,
  onConnected,
}: {
  preset: Preset;
  orgId?: string;
  workspaceId?: string;
  onConnected: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [smtpHost, setSmtpHost] = useState(preset.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(preset.smtpPort ?? "587");
  const [imapHost, setImapHost] = useState(preset.imapHost ?? "");
  const [imapPort, setImapPort] = useState(preset.imapPort ?? "993");
  const [advanced, setAdvanced] = useState(preset.key === "other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !!email.trim() && !!password && !!smtpHost.trim() && !busy && !!orgId;

  const submit = async () => {
    if (!canSubmit || !orgId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createIntegrationConnection({
        organizationId: orgId,
        workspaceId,
        providerKey: "smtp-email",
        name: email.trim(),
        config: {
          fromEmail: email.trim(),
          ...(displayName.trim() ? { fromName: displayName.trim() } : {}),
        },
        credentials: {
          host: smtpHost.trim(),
          port: smtpPort.trim() || "587",
          username: email.trim(),
          password,
          ...(imapHost.trim()
            ? { imapHost: imapHost.trim(), imapPort: imapPort.trim() || "993" }
            : {}),
        },
      });
      try {
        await verifyIntegrationConnection(created.id);
      } catch {
        /* verification is best-effort */
      }
      onConnected();
    } catch (err) {
      setError((err as Error).message || "Could not connect.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {preset.tip && (
        <div className="rounded-lg border border-app bg-app-hover/60 px-3 py-2.5 text-xs text-app-muted">
          {preset.tip}
          {preset.helpUrl && (
            <a
              href={preset.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              Learn how <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
      <Field label="Email address">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="border-app bg-app"
          autoComplete="off"
        />
      </Field>
      <Field label="Password / app password">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="app password"
          className="border-app bg-app font-mono"
          autoComplete="off"
        />
      </Field>
      <Field label="Display name (optional)">
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name or business"
          className="border-app bg-app"
        />
      </Field>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-app-muted hover:text-app"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition ${advanced ? "rotate-180" : ""}`}
        />
        Server settings {preset.key === "other" ? "" : "(pre-filled)"}
      </button>
      {advanced && (
        <div className="space-y-3 rounded-lg border border-app bg-app-surface p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="SMTP host (outgoing)">
              <Input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className="border-app bg-app font-mono"
              />
            </Field>
            <Field label="SMTP port">
              <Input
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                className="border-app bg-app font-mono"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="IMAP host (incoming)">
              <Input
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.example.com"
                className="border-app bg-app font-mono"
              />
            </Field>
            <Field label="IMAP port">
              <Input
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                placeholder="993"
                className="border-app bg-app font-mono"
              />
            </Field>
          </div>
          <p className="text-[11px] text-app-faint">
            IMAP is what lets your coworker read and reply to incoming mail.
            Leave blank for send-only.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      <Button
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="w-full gap-2"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Connect
      </Button>
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
