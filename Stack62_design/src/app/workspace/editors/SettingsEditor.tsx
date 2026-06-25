import { useEffect, useState } from "react";
import { Bell, Bot, Building2, Camera, CheckCircle2, Clock, ExternalLink, FileDown, Key, Landmark, Loader2, LogOut, Mail, MessageCircle, Monitor, Moon, Palette, Phone, Plug, RefreshCw, Save, ShieldCheck, Smartphone, Sun, Trash2, User, X, XCircle } from "lucide-react";
import { appDialog } from "../../components/app-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import { useTheme, type ThemeMode } from "../../context/theme-context";
import {
  auditExportCsvUrl,
  changeCurrentUserPassword,
  clearCurrentUserAvatar,
  disconnectIntegrationConnection,
  fetchCoworker,
  fetchEmailAgent,
  fetchIntegrationConnections,
  fetchWhatsAppAgent,
  fetchWhatsAppPhoneNumbers,
  fetchWhatsAppWebStatus,
  quickBooksOAuthUrl,
  resendCurrentUserVerification,
  selectWhatsAppPhoneNumber,
  startWhatsAppWebLink,
  updateCoworker,
  updateEmailAgent,
  updateCurrentUserProfile,
  updateOrgSettings,
  updateWhatsAppAgent,
  uploadCurrentUserAvatar,
  userAvatarUrl,
  whatsAppWebLogout,
  type Coworker,
  type EmailAgentConfig,
  type IntegrationConnection,
  type WhatsAppAgentConfig,
  type WhatsAppPhoneNumberOption,
  type WhatsAppWebStatus,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

/**
 * Settings is one editor tab now, with an internal sidenav. Sections
 * were grouped:
 *   - Account merges Profile + Appearance (your identity + how it looks)
 *   - Organization merges Org settings + Workspace settings
 *   - Coworker, Integrations, Notifications, Security, Billing stay as-is
 *
 * If a tab navigates here with refId="billing" we still respect that
 * as the initial section so deep-links continue to work — but the user
 * picks subsequent sections via the sidenav without spawning new tabs.
 */
type SettingsSection =
  | "account"
  | "coworker"
  | "whatsapp"
  | "integrations"
  | "security"
  | "billing";

const SECTIONS: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: typeof User;
}> = [
  { key: "account", label: "Account", description: "Profile, organization, and appearance", icon: User },
  { key: "coworker", label: "Coworker", description: "AI behaviour and tools", icon: Bot },
  { key: "whatsapp", label: "WhatsApp", description: "Link a device and auto-replies", icon: MessageCircle },
  { key: "integrations", label: "Integrations", description: "Connect Google, WhatsApp, etc.", icon: Plug },
  { key: "security", label: "Security", description: "Sessions, MFA, audit", icon: ShieldCheck },
  { key: "billing", label: "Billing", description: "Plan, seats, invoices", icon: Landmark },
];

function normalizeSection(raw: string | undefined): SettingsSection {
  switch (raw) {
    case "profile":
    case "appearance":
    case "account":
    case "workspace":
    case "organization":
      return "account";
    case "coworker":
    case "whatsapp":
    case "integrations":
    case "security":
    case "billing":
      return raw;
    case "notifications":
      // Notifications has moved to the top-bar bell; route stragglers
      // back to Account so this isn't a dead deep-link.
      return "account";
    default:
      return "account";
  }
}

/**
 * Settings — modal dialog (Linear / Notion pattern).
 *
 * Opens via a global event so any component (top-bar profile menu,
 * Coworker tool, command palette) can summon it. Closes on Escape
 * or outside-click. Categories live in the left rail of the dialog
 * itself — no more duplicate sidebar in the workspace chrome.
 *
 * Trigger:
 *   window.dispatchEvent(new CustomEvent('stack62:open-settings', {
 *     detail: { section?: SettingsSection }
 *   }))
 */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");

  // Subscribe to the global open event.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail =
        (event as CustomEvent<{ section?: string }>).detail ?? {};
      if (detail.section) {
        setSection(normalizeSection(detail.section));
      }
      setOpen(true);
    };
    window.addEventListener("stack62:open-settings", handler);
    return () => window.removeEventListener("stack62:open-settings", handler);
  }, []);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[85vh] w-full max-w-5xl overflow-hidden rounded-xl border border-app bg-app-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        {/* Left sidenav */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-app bg-app-surface">
          <div className="flex items-center gap-2 border-b border-app px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <h2 id="settings-dialog-title" className="text-sm font-semibold">
              Settings
            </h2>
          </div>
          <nav className="flex-1 overflow-auto p-2">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  section === key
                    ? "bg-accent text-accent-fg font-medium"
                    : "text-app-muted hover:bg-app-hover hover:text-app"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-app px-6 py-3">
            <div>
              <h1 className="text-lg font-semibold">
                {SECTIONS.find((s) => s.key === section)?.label}
              </h1>
              <p className="text-xs text-app-faint">
                {SECTIONS.find((s) => s.key === section)?.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app"
              aria-label="Close settings"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="flex-1 overflow-auto">
            <div className="mx-auto max-w-3xl p-6">
              {section === "account" && (
                <div className="space-y-6">
                  <ProfileSection />
                  <OrganizationSection />
                  <AppearanceSection />
                </div>
              )}
              {section === "coworker" && <CoworkerSection />}
              {section === "whatsapp" && <WhatsAppSection />}
              {section === "integrations" && <IntegrationsSection />}
              {section === "security" && <SecuritySection />}
              {section === "billing" && <BillingSection />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationsSection() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<{
    connection: IntegrationConnection;
    numbers: WhatsAppPhoneNumberOption[];
  } | null>(null);

  const reload = async () => {
    if (!currentOrganization) return;
    setLoading(true);
    const rows = await fetchIntegrationConnections({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace?.id,
    }).catch(() => []);
    setConnections(rows);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "stack62.integration.connected") return;
      void reload();
    };
    const onConnected = () => void reload();
    window.addEventListener("message", onMessage);
    window.addEventListener("stack62:email-connected", onConnected);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("stack62:email-connected", onConnected);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const providers = [
    {
      key: "quickbooks",
      name: "QuickBooks",
      description: "Customers, invoices, and accounting access through Intuit sign-in.",
      icon: Landmark,
      kind: "oauth" as const,
      start: "quickbooks" as const,
      button: "Sign in with Intuit",
    },
  ];

  const startOAuth = async (
    provider: Extract<(typeof providers)[number], { kind: "oauth" }>,
  ) => {
    if (!currentOrganization) return;
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/${provider.start}`;
      const basePayload = {
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        redirectUri,
      };
      const result = await quickBooksOAuthUrl(basePayload);
      window.open(result.url, "stack62_integration_oauth", "width=720,height=760");
      appendRunLog({
        level: "ok",
        text: `Opened ${provider.name} sign-in`,
        source: "integrations",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Sign-in failed: ${(err as Error).message}`,
        source: "integrations",
      });
    }
  };

  if (!currentOrganization) {
    return <p className="text-sm text-app-faint">Select an organization first.</p>;
  }

  return (
    <section className="space-y-3">
      <EmailConnectionCard connections={connections} onChanged={reload} />
      {loading ? (
        <div className="grid h-40 place-items-center text-app-faint">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        providers.map((provider) => {
          const connection = connections.find(
            (item) => item.providerKey === provider.key && item.status !== "disconnected",
          );
          const Icon = provider.icon;
          const ready =
            connection?.providerKey === "google-workspace" ||
            connection?.providerKey === "smtp-email" ||
            connection?.config?.setupStatus === "ready";
          return (
            <div
              key={provider.key}
              className="rounded-lg border border-app bg-app-hover p-4"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">{provider.name}</h2>
                    {connection ? (
                      ready ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> connected
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                          setup needed
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-app-elevated px-2 py-0.5 text-[10px] text-app-muted">
                        <XCircle className="h-3 w-3" /> not connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-app-faint">{provider.description}</p>
                  {connection?.config?.displayPhoneNumber && (
                    <p className="mt-2 text-xs text-emerald-200">
                      Sending number: {String(connection.config.displayPhoneNumber)}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void startOAuth(provider)}
                  className="gap-1"
                >
                  <Plug className="h-3.5 w-3.5" />
                  {connection ? "Reconnect" : provider.button}
                </Button>
                {connection?.providerKey === "whatsapp-cloud" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const result = await fetchWhatsAppPhoneNumbers(connection.id);
                        setPicker({ connection, numbers: result.phoneNumbers });
                      } catch (err) {
                        appendRunLog({
                          level: "error",
                          text: `Could not load WhatsApp numbers: ${(err as Error).message}`,
                          source: "integrations",
                        });
                      }
                    }}
                  >
                    Choose number
                  </Button>
                )}
                {connection && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-900/70 text-rose-200 hover:bg-rose-950/30"
                    onClick={async () => {
                      try {
                        const updated = await disconnectIntegrationConnection(connection.id);
                        setConnections((cur) =>
                          cur.map((item) => (item.id === updated.id ? updated : item)),
                        );
                        appendRunLog({
                          level: "ok",
                          text: `${provider.name} disconnected`,
                          source: "integrations",
                        });
                      } catch (err) {
                        appendRunLog({
                          level: "error",
                          text: `Disconnect failed: ${(err as Error).message}`,
                          source: "integrations",
                        });
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}
      <EmailAssistantCard />
      {picker && (
        <WhatsAppNumberPicker
          numbers={picker.numbers}
          onClose={() => setPicker(null)}
          onSelect={async (number) => {
            const updated = await selectWhatsAppPhoneNumber(picker.connection.id, {
              phoneNumberId: number.id,
              displayPhoneNumber: number.displayPhoneNumber,
              verifiedName: number.verifiedName,
              businessAccountId: number.businessAccountId,
            });
            setConnections((cur) =>
              cur.map((item) => (item.id === updated.id ? updated : item)),
            );
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * Email connection: shows connected mailboxes and launches the guided
 * "Connect your email" wizard (EmailConnectDialog) — no hardcoded marketplace.
 */
function EmailConnectionCard({
  connections,
  onChanged,
}: {
  connections: IntegrationConnection[];
  onChanged: () => void;
}) {
  const { appendRunLog } = useWorkspace();
  const mailboxes = connections.filter(
    (c) =>
      (c.providerKey === "google-workspace" ||
        c.providerKey === "smtp-email") &&
      c.status !== "disconnected",
  );

  const providerLabel = (key: string) =>
    key === "google-workspace" ? "Gmail (Google)" : "Email (SMTP/IMAP)";

  const disconnect = async (id: string) => {
    try {
      await disconnectIntegrationConnection(id);
      appendRunLog({ level: "ok", text: "Mailbox disconnected.", source: "integrations" });
      onChanged();
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Disconnect failed: ${(err as Error).message}`,
        source: "integrations",
      });
    }
  };

  return (
    <Card icon={Mail} title="Email">
      <p className="mb-3 text-xs text-app-faint">
        Connect your own mailbox so you and your coworker can send and read
        email from it.
      </p>
      {mailboxes.length > 0 && (
        <div className="mb-3 space-y-2">
          {mailboxes.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-app bg-app p-2.5 text-xs"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-app">
                  {c.name || providerLabel(c.providerKey)}
                </span>
                <span className="text-app-faint">
                  {providerLabel(c.providerKey)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void disconnect(c.id)}
                className="rounded px-2 py-1 text-rose-500 hover:bg-rose-500/10"
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}
      <Button
        size="sm"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("stack62:open-email-connect"))
        }
        className="gap-1.5"
      >
        <Plug className="h-3.5 w-3.5" />
        {mailboxes.length > 0 ? "Connect another mailbox" : "Connect email"}
      </Button>
    </Card>
  );
}

/**
 * Email assistant: lets the coworker proactively read incoming mail and draft
 * (or auto-send) replies. Per-workspace config, mirroring the WhatsApp card.
 */
function EmailAssistantCard() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [config, setConfig] = useState<EmailAgentConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) return;
    let live = true;
    fetchEmailAgent({
      organizationId: currentOrganization.id,
      workspaceId: currentWorkspace.id,
    })
      .then((c) => {
        if (live) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [currentOrganization?.id, currentWorkspace?.id]);

  if (!currentOrganization || !currentWorkspace || !config) return null;

  const patch = (next: Partial<EmailAgentConfig>) =>
    setConfig((cur) => (cur ? { ...cur, ...next } : cur));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const saved = await updateEmailAgent({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace.id,
        enabled: config.enabled,
        autoSend: config.autoSend,
        responseSchedule: config.responseSchedule,
        tone: config.tone ?? undefined,
        identityName: config.identityName ?? undefined,
        identityRole: config.identityRole ?? undefined,
        signature: config.signature ?? undefined,
        businessInfo: config.businessInfo ?? undefined,
        maxAutoRepliesPerDay: config.maxAutoRepliesPerDay,
      });
      setConfig(saved);
      appendRunLog({
        level: "ok",
        text: "Email assistant settings saved.",
        source: "integrations",
      });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "integrations",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Email assistant" icon={Mail}>
      <p className="mb-3 text-xs text-app-faint">
        Let your coworker watch your connected mailbox, summarise new email, and
        prepare replies. Drafts wait for your approval in the Email inbox unless
        you turn on auto-send.
      </p>
      <div className="space-y-2">
        <Toggle
          label="Monitor incoming email"
          description="Read new mail and prepare a reply for each."
          checked={config.enabled}
          onChange={(v) => patch({ enabled: v })}
        />
        <Toggle
          label="Auto-send replies"
          description="Send automatically instead of leaving a draft for approval."
          checked={config.autoSend}
          onChange={(v) => patch({ autoSend: v })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Replies as (name)">
            <Input
              value={config.identityName ?? ""}
              onChange={(e) => patch({ identityName: e.target.value })}
              className="border-app bg-app"
              placeholder="e.g. Ada"
            />
          </Field>
          <Field label="Role">
            <Input
              value={config.identityRole ?? ""}
              onChange={(e) => patch({ identityRole: e.target.value })}
              className="border-app bg-app"
              placeholder="e.g. support for Acme"
            />
          </Field>
        </div>
        <Field label="Signature (optional)">
          <Input
            value={config.signature ?? ""}
            onChange={(e) => patch({ signature: e.target.value })}
            className="border-app bg-app"
            placeholder="— Ada, Acme Support"
          />
        </Field>
        <Field label="Business information the coworker can use">
          <textarea
            value={config.businessInfo ?? ""}
            onChange={(e) => patch({ businessInfo: e.target.value })}
            rows={4}
            className="w-full resize-y rounded-md border border-app bg-app px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="Hours, pricing, policies, FAQs… the source of truth for replies."
          />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WhatsAppNumberPicker({
  numbers,
  onClose,
  onSelect,
}: {
  numbers: WhatsAppPhoneNumberOption[];
  onClose: () => void;
  onSelect: (number: WhatsAppPhoneNumberOption) => void | Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-app-strong bg-app-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-app px-4 py-3">
          <MessageCircle className="h-4 w-4 text-emerald-300" />
          <h2 className="text-sm font-semibold">Choose WhatsApp number</h2>
          <button
            onClick={onClose}
            className="ml-auto grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-app-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {numbers.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-app-faint">
              No WhatsApp Business numbers were found for this Meta account.
            </p>
          ) : (
            <div className="space-y-2">
              {numbers.map((number) => (
                <button
                  key={number.id}
                  onClick={() => void onSelect(number)}
                  className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-lg border border-app bg-app px-3 py-2 text-left hover:bg-app-hover"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-app">
                      {number.verifiedName ?? number.displayPhoneNumber}
                    </span>
                    <span className="block truncate text-xs text-app-faint">
                      {number.displayPhoneNumber} · {number.businessName}
                    </span>
                  </span>
                  <span className="self-center rounded bg-emerald-500/15 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300">
                    Use
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WhatsAppSection() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  if (!currentOrganization || !currentWorkspace) {
    return <p className="text-sm text-app-faint">Select a workspace first.</p>;
  }
  return (
    <div className="space-y-6">
      <WhatsAppDeviceCard
        organizationId={currentOrganization.id}
        workspaceId={currentWorkspace.id}
      />
      <WhatsAppAutoReplyCard
        organizationId={currentOrganization.id}
        workspaceId={currentWorkspace.id}
      />
      <p className="rounded-lg border border-app bg-app-hover p-3 text-xs text-app-faint">
        Your WhatsApp chats now live in the chat panel — open the Coworker and
        switch to the <span className="font-medium text-app">WhatsApp</span> tab
        to read and reply to conversations.
      </p>
    </div>
  );
}

/** Link a phone number as a companion device using the pairing code. */
function WhatsAppDeviceCard({
  organizationId,
  workspaceId,
}: {
  organizationId: string;
  workspaceId: string;
}) {
  const { appendRunLog } = useWorkspace();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsAppWebStatus | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchIntegrationConnections({ organizationId, workspaceId })
      .then((rows) => {
        if (!live) return;
        const conn = rows.find(
          (r) => r.providerKey === "whatsapp-web" && r.status !== "disconnected",
        );
        if (conn) setConnectionId(conn.id);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [organizationId, workspaceId]);

  // Poll status while a link exists and isn't ready yet.
  useEffect(() => {
    if (!connectionId) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await fetchWhatsAppWebStatus(connectionId);
        if (!live) return;
        setStatus(s);
        if (s.pairingCode) setCode(s.pairingCode);
      } catch {
        /* ignore transient errors */
      }
    };
    void tick();
    const timer = setInterval(() => {
      if (status?.status === "ready") return;
      void tick();
    }, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [connectionId, status?.status]);

  const startLink = async () => {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.length < 8) {
      setError("Enter the full phone number including country code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await startWhatsAppWebLink({
        organizationId,
        workspaceId,
        phoneNumber: digits,
        connectionId: connectionId ?? undefined,
      });
      setConnectionId(result.connectionId);
      setCode(result.pairingCode);
      if (!result.pairingCode) {
        setError(
          "WhatsApp did not return a code. Wait a few seconds and tap “New code”.",
        );
      }
      appendRunLog({
        level: "ok",
        text: `Pairing code ready: ${result.pairingCode ?? "—"}`,
        source: "whatsapp",
      });
    } catch (err) {
      const message = (err as Error).message || "Request failed.";
      setError(message);
      // eslint-disable-next-line no-console
      console.error("WhatsApp link failed:", err);
      appendRunLog({
        level: "error",
        text: `Could not start link: ${message}`,
        source: "whatsapp",
      });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!connectionId) return;
    setBusy(true);
    try {
      await whatsAppWebLogout(connectionId);
      setConnectionId(null);
      setStatus(null);
      setCode(null);
      appendRunLog({ level: "ok", text: "WhatsApp device unlinked.", source: "whatsapp" });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Unlink failed: ${(err as Error).message}`,
        source: "whatsapp",
      });
    } finally {
      setBusy(false);
    }
  };

  const ready = status?.status === "ready";

  return (
    <Card icon={Smartphone} title="Link a device">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-app-faint" />
      ) : ready ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Linked{status?.phoneNumber ? ` · +${status.phoneNumber}` : ""}. The
              coworker can send and receive on this WhatsApp account.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void unlink()}
            className="gap-1 border-rose-900/70 text-rose-200 hover:bg-rose-950/30"
          >
            <X className="h-3.5 w-3.5" /> Unlink device
          </Button>
        </div>
      ) : code ? (
        <div className="space-y-3">
          <p className="text-xs text-app-subtle">
            On the phone: <strong>WhatsApp → Settings → Linked devices → Link a
            device → “Link with phone number instead”</strong>, then enter:
          </p>
          <div className="flex items-center gap-3">
            <code className="rounded-md border border-app bg-app px-4 py-2 text-lg font-bold tracking-[0.3em] text-app">
              {code}
            </code>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
              <Clock className="h-3 w-3" />
              {status?.status === "connecting" ? "connecting…" : "waiting for phone…"}
            </span>
          </div>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void startLink()} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> New code
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-app-faint">
            Enter a phone number with country code. You’ll get a one-time code to
            type into WhatsApp on that phone — like adding any other device.
          </p>
          <Field label="Phone number (with country code)">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-app-faint" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+234 803 000 0000"
                className="border-app bg-app-surface"
              />
            </div>
          </Field>
          <Button size="sm" disabled={busy} onClick={() => void startLink()} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
            {busy ? "Requesting code…" : "Get pairing code"}
          </Button>
          {busy && (
            <p className="text-[11px] text-app-faint">
              Asking WhatsApp for a code — this can take up to 15 seconds.
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1.5 rounded-md border border-rose-900/60 bg-rose-950/20 p-2 text-[11px] text-rose-200">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Configure how the coworker auto-replies on WhatsApp. */
function WhatsAppAutoReplyCard({
  organizationId,
  workspaceId,
}: {
  organizationId: string;
  workspaceId: string;
}) {
  const { appendRunLog } = useWorkspace();
  const [config, setConfig] = useState<WhatsAppAgentConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchWhatsAppAgent(organizationId, workspaceId)
      .then((c) => live && setConfig(c))
      .catch(() => live && setConfig(null));
    return () => {
      live = false;
    };
  }, [organizationId, workspaceId]);

  const patch = (next: Partial<WhatsAppAgentConfig>) =>
    setConfig((c) => (c ? { ...c, ...next } : c));

  const hours = config?.businessHours ?? {
    timezone: "Africa/Lagos",
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "17:00",
  };
  const patchHours = (next: Partial<typeof hours>) =>
    patch({ businessHours: { ...hours, ...next } });

  const save = async () => {
    if (!config) return;
    setBusy(true);
    try {
      const saved = await updateWhatsAppAgent({
        organizationId,
        workspaceId,
        autoReplyEnabled: config.autoReplyEnabled,
        responseSchedule: config.responseSchedule,
        businessHours: config.businessHours ?? hours,
        tone: config.tone,
        responseDelaySeconds: config.responseDelaySeconds,
        identityName: config.identityName,
        identityRole: config.identityRole,
        signature: config.signature,
        businessInfo: config.businessInfo,
        awayMessage: config.awayMessage,
        maxAutoRepliesPerDay: config.maxAutoRepliesPerDay,
      });
      setConfig(saved);
      appendRunLog({ level: "ok", text: "WhatsApp auto-reply saved.", source: "whatsapp" });
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Save failed: ${(err as Error).message}`,
        source: "whatsapp",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <Card icon={Bot} title="Automatic replies">
        <Loader2 className="h-4 w-4 animate-spin text-app-faint" />
      </Card>
    );
  }

  return (
    <Card icon={Bot} title="Automatic replies">
      <Toggle
        label="Let the coworker reply automatically"
        description="When on, incoming WhatsApp messages get an AI reply using the settings below."
        checked={config.autoReplyEnabled}
        onChange={(v) => patch({ autoReplyEnabled: v })}
      />

      <Field label="When to reply">
        <select
          value={config.responseSchedule}
          onChange={(e) =>
            patch({ responseSchedule: e.target.value as WhatsAppAgentConfig["responseSchedule"] })
          }
          className="h-9 w-full rounded-md border border-app bg-app-surface px-2 text-sm"
        >
          <option value="always">Always</option>
          <option value="business_hours">Only during business hours</option>
          <option value="after_hours">Only outside business hours</option>
        </select>
      </Field>

      {config.responseSchedule !== "always" && (
        <div className="space-y-2 rounded-md border border-app bg-app p-3">
          <Field label="Timezone">
            <Input
              value={hours.timezone}
              onChange={(e) => patchHours({ timezone: e.target.value })}
              placeholder="Africa/Lagos"
              className="border-app bg-app-surface"
            />
          </Field>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((label, idx) => {
              const active = hours.days.includes(idx);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    patchHours({
                      days: active
                        ? hours.days.filter((d) => d !== idx)
                        : [...hours.days, idx].sort((a, b) => a - b),
                    })
                  }
                  className={`rounded-md px-2 py-1 text-[11px] ${
                    active ? "bg-accent text-accent-fg" : "bg-app-hover text-app-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={hours.start}
              onChange={(e) => patchHours({ start: e.target.value })}
              className="h-8 border-app bg-app-surface text-sm"
            />
            <span className="text-xs text-app-faint">to</span>
            <Input
              type="time"
              value={hours.end}
              onChange={(e) => patchHours({ end: e.target.value })}
              className="h-8 border-app bg-app-surface text-sm"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Coworker name (shown in replies)">
          <Input
            value={config.identityName ?? ""}
            onChange={(e) => patch({ identityName: e.target.value })}
            placeholder="Ada"
            className="border-app bg-app-surface"
          />
        </Field>
        <Field label="Role / who they are">
          <Input
            value={config.identityRole ?? ""}
            onChange={(e) => patch({ identityRole: e.target.value })}
            placeholder="customer support for Acme Stores"
            className="border-app bg-app-surface"
          />
        </Field>
      </div>

      <Field label="Manner of response (tone)">
        <textarea
          value={config.tone ?? ""}
          onChange={(e) => patch({ tone: e.target.value })}
          rows={2}
          placeholder="Warm, helpful, and professional. Keep replies short."
          className="w-full rounded-md border border-app bg-app-surface p-2 text-sm"
        />
      </Field>

      <Field label="What the coworker should know about the business">
        <textarea
          value={config.businessInfo ?? ""}
          onChange={(e) => patch({ businessInfo: e.target.value })}
          rows={5}
          placeholder="Hours, location, products & prices, delivery, return policy, FAQs… the coworker answers only from this."
          className="w-full rounded-md border border-app bg-app-surface p-2 text-sm"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Response delay (seconds)">
          <Input
            type="number"
            min={0}
            max={600}
            value={config.responseDelaySeconds}
            onChange={(e) => patch({ responseDelaySeconds: Number(e.target.value) })}
            className="border-app bg-app-surface"
          />
        </Field>
        <Field label="Max auto-replies / chat / day (0 = unlimited)">
          <Input
            type="number"
            min={0}
            max={100}
            value={config.maxAutoRepliesPerDay}
            onChange={(e) => patch({ maxAutoRepliesPerDay: Number(e.target.value) })}
            className="border-app bg-app-surface"
          />
        </Field>
      </div>

      <Field label="Signature (optional)">
        <Input
          value={config.signature ?? ""}
          onChange={(e) => patch({ signature: e.target.value })}
          placeholder="— Ada, Acme Support"
          className="border-app bg-app-surface"
        />
      </Field>

      <Field label="Away message (sent outside the reply window)">
        <textarea
          value={config.awayMessage ?? ""}
          onChange={(e) => patch({ awayMessage: e.target.value })}
          rows={2}
          placeholder="Thanks for your message! We're away right now and will reply during business hours."
          className="w-full rounded-md border border-app bg-app-surface p-2 text-sm"
        />
      </Field>

      <Button onClick={() => void save()} disabled={busy} className="gap-1">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save auto-reply settings
      </Button>
    </Card>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-app bg-app-hover p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-emerald-400" />
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function ProfileSection() {
  const { user, currentOrganization, logout, refreshContext } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Cache-bust the avatar so a fresh upload doesn't keep showing the
  // old image from the browser's disk cache.
  const [avatarV, setAvatarV] = useState(user?.updatedAt ?? "");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setAvatarV(user?.updatedAt ?? "");
  }, [user?.id, user?.firstName, user?.lastName, user?.updatedAt]);

  const initials = (() => {
    const f = user?.firstName?.[0] ?? "";
    const l = user?.lastName?.[0] ?? "";
    return (f + l).toUpperCase() || "U";
  })();
  const avatarSrc =
    user?.avatarFileId && user.id ? userAvatarUrl(user.id, avatarV) : null;

  const onPickAvatar = async (file: File | undefined) => {
    if (!file || !user || !currentOrganization) return;
    if (file.size > 5 * 1024 * 1024) {
      await appDialog.alert({
        title: "Image too large",
        description: "Keep it under 5MB. Compress with any image tool first.",
        tone: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      await uploadCurrentUserAvatar(file, currentOrganization.id);
      await refreshContext();
      setAvatarV(String(Date.now()));
      appendRunLog({
        level: "ok",
        text: "Profile photo updated.",
        source: "profile",
      });
    } catch (err) {
      await appDialog.alert({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onClearAvatar = async () => {
    if (!user?.avatarFileId) return;
    const ok = await appDialog.confirm({
      title: "Remove profile photo?",
      description: "Your initials will show again until you upload a new one.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await clearCurrentUserAvatar();
      await refreshContext();
    } catch (err) {
      await appDialog.alert({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    }
  };

  const onSaveName = async () => {
    if (!user) return;
    const cleanFirst = firstName.trim();
    const cleanLast = lastName.trim();
    if (!cleanFirst || !cleanLast) {
      await appDialog.alert({
        title: "Name required",
        description: "First and last names cannot be empty.",
      });
      return;
    }
    if (cleanFirst === user.firstName && cleanLast === user.lastName) return;
    setSavingName(true);
    try {
      await updateCurrentUserProfile({
        firstName: cleanFirst,
        lastName: cleanLast,
      });
      await refreshContext();
      appendRunLog({
        level: "ok",
        text: "Profile saved.",
        source: "profile",
      });
    } catch (err) {
      await appDialog.alert({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <section className="rounded-xl border border-app bg-app-elevated p-6 shadow-sm">
      <div className="flex items-start gap-5">
        {/* Avatar with hover-to-upload */}
        <label className="group relative cursor-pointer">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-accent text-2xl font-semibold text-accent-fg shadow-sm">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </div>
          <div className="absolute inset-0 grid place-items-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <Camera className="h-5 w-5 text-white" />
            )}
          </div>
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={uploading || !currentOrganization}
            onChange={(e) => void onPickAvatar(e.target.files?.[0])}
          />
        </label>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
                First name
              </label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-8 border-app bg-app-surface text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-app-faint">
                Last name
              </label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-8 border-app bg-app-surface text-sm"
              />
            </div>
          </div>
          <p className="truncate text-xs text-app-muted">
            {user?.email ?? "—"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void onSaveName()}
              disabled={
                savingName ||
                (firstName === user?.firstName && lastName === user?.lastName)
              }
              className="gap-1"
            >
              {savingName ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
            {user?.avatarFileId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onClearAvatar()}
                className="gap-1 border-app"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove photo
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={logout}
              className="ml-auto gap-1 border-app"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-app-faint">
        Click your photo to upload a new one (PNG, JPG, WebP, GIF · under 5MB).
      </p>
      {user && <EmailVerificationStatus user={user} />}
    </section>
  );
}

function EmailVerificationStatus({
  user,
}: {
  user: { email: string; emailVerifiedAt?: string | null };
}) {
  const { appendRunLog } = useWorkspace();
  const [sending, setSending] = useState(false);
  const verified = !!user.emailVerifiedAt;

  const resend = async () => {
    setSending(true);
    try {
      const result = await resendCurrentUserVerification();
      if (result.alreadyVerified) {
        await appDialog.alert({
          title: "Already verified",
          description: "Your email is already confirmed. You're set.",
          tone: "success",
        });
      } else {
        await appDialog.alert({
          title: "Verification email sent",
          description: `Check ${user.email}. The link expires in 24 hours.`,
          tone: "success",
        });
      }
      appendRunLog({
        level: "ok",
        text: "Verification email re-sent.",
        source: "account",
      });
    } catch (err) {
      await appDialog.alert({
        title: "Couldn't send",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-md border p-3 text-xs ${
        verified
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-300"
      }`}
    >
      {verified ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Mail className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {verified ? "Email verified" : "Email not verified"}
        </p>
        <p className="mt-0.5 text-[11px] opacity-80">
          {verified
            ? `Verified on ${new Date(user.emailVerifiedAt!).toLocaleDateString()}.`
            : "Verify your email to receive shared docs, plan approvals, and account-recovery messages."}
        </p>
        {!verified && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void resend()}
            disabled={sending}
            className="mt-2 gap-1 border-current bg-transparent hover:bg-current/10"
          >
            {sending && <Loader2 className="h-3 w-3 animate-spin" />}
            Send verification email
          </Button>
        )}
      </div>
    </div>
  );
}

function OrganizationSection() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  if (!currentOrganization) {
    return <p className="text-sm text-app-faint">Select an organization first.</p>;
  }

  return (
    <Card icon={Building2} title="Organization">
      <Field label="Organization name">
        <Input
          value={currentOrganization.name}
          readOnly
          className="border-app bg-app-surface"
        />
      </Field>
      {currentWorkspace && (
        <Field label="Workspace">
          <Input
            value={currentWorkspace.name}
            readOnly
            className="border-app bg-app-surface"
          />
        </Field>
      )}
      <Field label="Preferred model">
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="anthropic/claude-3.5-sonnet"
          className="border-app bg-app-surface font-mono"
        />
      </Field>
      <Button
        onClick={async () => {
          setBusy(true);
          try {
            await updateOrgSettings(currentOrganization.id, {
              preferredModel: model || null,
            });
            appendRunLog({
              level: "ok",
              text: "Organization settings saved",
              source: "settings",
            });
          } catch (err) {
            appendRunLog({
              level: "error",
              text: `Save failed: ${(err as Error).message}`,
              source: "settings",
            });
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="gap-1"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </Button>
    </Card>
  );
}

function CoworkerSection() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog, setAutopilot } = useWorkspace();
  const [coworker, setCoworker] = useState<Coworker | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    voice: "",
    defaultAutopilot: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!currentOrganization || !currentWorkspace) return;
    let live = true;
    void fetchCoworker(currentOrganization.id, currentWorkspace.id)
      .then((c) => {
        if (!live) return;
        setCoworker(c);
        setDraft({
          name: c.name,
          description: c.description ?? "",
          voice: c.voice ?? "",
          defaultAutopilot: c.defaultAutopilot,
        });
        setAutopilot(c.defaultAutopilot);
      })
      .catch(() => live && setCoworker(null));
    return () => {
      live = false;
    };
  }, [currentOrganization, currentWorkspace, setAutopilot]);

  if (!currentOrganization || !currentWorkspace) {
    return <p className="text-sm text-app-faint">Select a workspace first.</p>;
  }

  return (
    <Card icon={Bot} title="Workspace coworker">
      {!coworker && !draft.name ? (
        <Loader2 className="h-4 w-4 animate-spin text-app-faint" />
      ) : (
        <>
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Role">
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="What this coworker handles for the workspace"
              className="border-app bg-app-surface"
            />
          </Field>
          <Field label="Voice">
            <Input
              value={draft.voice}
              onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
              placeholder="Clear, concise, calm"
              className="border-app bg-app-surface"
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-app-muted">
            <input
              type="checkbox"
              checked={draft.defaultAutopilot}
              onChange={(e) =>
                setDraft((d) => ({ ...d, defaultAutopilot: e.target.checked }))
              }
            />
            Autopilot on by default for this workspace
          </label>
          <Button
            onClick={async () => {
              setBusy(true);
              try {
                const saved = await updateCoworker({
                  organizationId: currentOrganization.id,
                  workspaceId: currentWorkspace.id,
                  name: draft.name || "Ada",
                  description: draft.description || null,
                  voice: draft.voice || null,
                  defaultAutopilot: draft.defaultAutopilot,
                });
                setCoworker(saved);
                setAutopilot(saved.defaultAutopilot);
                appendRunLog({
                  level: "ok",
                  text: "Coworker saved for this workspace",
                  source: "coworker",
                });
              } catch (err) {
                appendRunLog({
                  level: "error",
                  text: `Coworker save failed: ${(err as Error).message}`,
                  source: "coworker",
                });
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="gap-1"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save coworker
          </Button>
        </>
      )}
    </Card>
  );
}

function NotificationsSection() {
  // Channels the user gets pinged on. Stored locally for now until
  // the backend grows a real preferences table — keeping the UI honest
  // about which toggles are persisted across devices.
  const [emailDigest, setEmailDigest] = useState(true);
  const [emailMentions, setEmailMentions] = useState(true);
  const [emailPlans, setEmailPlans] = useState(true);
  const [inAppAll, setInAppAll] = useState(true);
  const [dndStart, setDndStart] = useState("");
  const [dndEnd, setDndEnd] = useState("");
  return (
    <div className="space-y-4">
      <Card icon={Bell} title="Email notifications">
        <Toggle
          label="Weekly digest"
          description="A roundup of plans approved, jobs that ran, and pending decisions."
          checked={emailDigest}
          onChange={setEmailDigest}
        />
        <Toggle
          label="Direct mentions"
          description="When someone @mentions you in a room or comment."
          checked={emailMentions}
          onChange={setEmailMentions}
        />
        <Toggle
          label="Plan needs approval"
          description="A teammate (or the Coworker) drafted a change waiting for your review."
          checked={emailPlans}
          onChange={setEmailPlans}
        />
      </Card>
      <Card icon={Smartphone} title="In-app">
        <Toggle
          label="Show toasts for everything"
          description="When off, only direct mentions + plan approvals will flash a toast."
          checked={inAppAll}
          onChange={setInAppAll}
        />
        <Field label="Do not disturb (your timezone)">
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={dndStart}
              onChange={(e) => setDndStart(e.target.value)}
              className="h-8 border-app bg-app-surface text-sm"
            />
            <span className="text-xs text-app-faint">to</span>
            <Input
              type="time"
              value={dndEnd}
              onChange={(e) => setDndEnd(e.target.value)}
              className="h-8 border-app bg-app-surface text-sm"
            />
          </div>
        </Field>
      </Card>
      <p className="text-[11px] text-app-faint">
        These preferences are stored on this device. Cross-device sync ships when the notifications service lands.
      </p>
    </div>
  );
}

function SecuritySection() {
  const { user, currentOrganization } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changing, setChanging] = useState(false);

  const onChangePassword = async () => {
    if (newPw.length < 8) {
      await appDialog.alert({
        title: "Password too short",
        description: "Use at least 8 characters.",
        tone: "destructive",
      });
      return;
    }
    if (newPw !== confirmPw) {
      await appDialog.alert({
        title: "Passwords don't match",
        description: "Re-enter the new password to confirm.",
        tone: "destructive",
      });
      return;
    }
    setChanging(true);
    try {
      await changeCurrentUserPassword({
        currentPassword: currentPw,
        newPassword: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      await appDialog.alert({
        title: "Password updated",
        description:
          "Your password has been rotated. Existing sessions stay signed in until they expire.",
        tone: "success",
      });
      appendRunLog({
        level: "ok",
        text: "Password changed.",
        source: "security",
      });
    } catch (err) {
      await appDialog.alert({
        title: "Couldn't change password",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "destructive",
      });
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card icon={Key} title="Password">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="border-app bg-app-surface"
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="At least 8 characters"
            className="border-app bg-app-surface"
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="border-app bg-app-surface"
          />
        </Field>
        <Button
          size="sm"
          onClick={() => void onChangePassword()}
          disabled={
            changing || !currentPw || !newPw || !confirmPw
          }
          className="gap-1"
        >
          {changing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Update password
        </Button>
      </Card>

      <Card icon={ShieldCheck} title="Two-factor authentication">
        <div className="rounded-md border border-app bg-app p-3 text-xs">
          <p className="font-medium text-app">Not enabled</p>
          <p className="mt-0.5 text-app-faint">
            Add a second sign-in factor (authenticator app or hardware key).
            Strongly recommended for org owners.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled
            className="mt-2 gap-1 border-app"
            title="Two-factor setup is coming. Email verification + strong passwords are enforced today."
          >
            Set up 2FA — coming soon
          </Button>
        </div>
      </Card>

      <Card icon={Smartphone} title="Active sessions">
        <p className="text-xs text-app-muted">
          You're signed in on this device.
        </p>
        <p className="mt-2 text-[11px] text-app-faint">
          A per-device session list and "Sign out everywhere" land with
          the session-store rollout. JWTs currently expire on a fixed
          schedule, so any stolen token times out on its own.
        </p>
      </Card>

      <Card icon={FileDown} title="Audit log">
        <p className="text-xs text-app-muted">
          Every plan, schema change, and external send is recorded on
          your org. Export the full log for compliance.
        </p>
        {currentOrganization ? (
          <a
            href={auditExportCsvUrl(currentOrganization.id)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-app px-3 py-1.5 text-xs hover:bg-app-hover"
          >
            <FileDown className="h-3.5 w-3.5" /> Download CSV
          </a>
        ) : (
          <p className="text-[11px] text-app-faint">
            Select an organization first.
          </p>
        )}
      </Card>

      <Card icon={Trash2} title="Danger zone">
        <p className="text-xs text-app-muted">
          Deleting your account removes your profile, avatar, and DMs.
          Anything in shared organizations stays (ownership transfers to
          another admin, or the org goes read-only).
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled
          className="mt-2 gap-1 border-rose-900/60 text-rose-300"
          title="Account deletion needs an ownership-transfer flow first. We won't ship the destructive button until the safe path exists."
        >
          Delete my account — coming soon
        </Button>
      </Card>

      {user && (
        <p className="text-[11px] text-app-faint">
          Signed in as {user.email}. Account id <code>{user.id.slice(0, 8)}</code>.
        </p>
      )}
    </div>
  );
}

function BillingSection() {
  const { currentOrganization } = useAppContext();
  // No billing service yet — we surface the org id and a clear note so
  // operators know where to look once Stripe is wired in. Showing fake
  // plan names ("Pro Plan") would be worse than nothing.
  return (
    <div className="space-y-4">
      <Card icon={Landmark} title="Current plan">
        <p className="text-xs text-app-muted">
          Stack62 is in self-hosted preview. All capabilities are
          available to your organization while we finalise the metered
          billing tier.
        </p>
        {currentOrganization && (
          <p className="mt-2 text-[11px] text-app-faint">
            Organization: <strong>{currentOrganization.name}</strong> ·
            id <code>{currentOrganization.id.slice(0, 8)}</code>
          </p>
        )}
      </Card>
      <Card icon={ExternalLink} title="Invoices">
        <p className="text-xs text-app-faint">
          Invoice history will appear here once the billing service is
          live. Until then, contact support for an off-cycle invoice.
        </p>
      </Card>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-app bg-app p-3 text-xs">
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-app">{label}</span>
        {description && (
          <span className="mt-0.5 block text-app-faint">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? "bg-accent" : "bg-app-hover"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function AppearanceSection() {
  const { mode, resolved, setMode } = useTheme();
  const options: Array<{
    value: ThemeMode;
    label: string;
    description: string;
    icon: typeof Sun;
  }> = [
    {
      value: "light",
      label: "Light",
      description: "Bright, paper-like surfaces.",
      icon: Sun,
    },
    {
      value: "dark",
      label: "Dark",
      description: "Easy on the eyes for long evening sessions.",
      icon: Moon,
    },
    {
      value: "system",
      label: "Match system",
      description: "Follows your OS preference automatically.",
      icon: Monitor,
    },
  ];
  return (
    <Card icon={Palette} title="Appearance">
      <p className="mb-3 text-xs text-app-subtle">
        Currently rendering in <span className="font-semibold text-app">{resolved}</span> mode.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                active
                  ? "border-accent bg-accent-soft text-app shadow-sm"
                  : "border-app bg-app-elevated text-app-muted hover:border-app-strong hover:text-app"
              }`}
            >
              <div className="flex w-full items-center gap-2">
                <span className={`grid h-7 w-7 place-items-center rounded-lg ${
                  active ? "bg-accent text-accent-fg" : "bg-app-hover text-app-muted"
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-semibold">{opt.label}</span>
                {active && (
                  <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-accent" />
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-app-subtle">
                {opt.description}
              </p>
            </button>
          );
        })}
      </div>
    </Card>
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
