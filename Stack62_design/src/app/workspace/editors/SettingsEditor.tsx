import { useEffect, useState } from "react";
import { Bell, Bot, Building2, CheckCircle2, Landmark, Loader2, LogOut, MessageCircle, Monitor, Moon, Palette, Plug, Save, ShieldCheck, Sun, User, X, XCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import { useTheme, type ThemeMode } from "../../context/theme-context";
import {
  disconnectIntegrationConnection,
  fetchCoworker,
  fetchIntegrationConnections,
  fetchOrganizations,
  fetchWhatsAppPhoneNumbers,
  googleOAuthUrl,
  metaOAuthUrl,
  quickBooksOAuthUrl,
  selectWhatsAppPhoneNumber,
  updateCoworker,
  updateOrgSettings,
  type Coworker,
  type IntegrationConnection,
  type WhatsAppPhoneNumberOption,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function SettingsEditor({ tab }: { tab: EditorTab }) {
  const section = tab.refId ?? "profile";
  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-3xl p-6">
        <header className="mb-4 flex items-center gap-2 border-b border-app pb-3">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h1 className="text-lg font-semibold capitalize">Settings · {section}</h1>
        </header>
        {section === "profile" && <ProfileSection />}
        {section === "appearance" && <AppearanceSection />}
        {section === "organization" && <OrganizationSection />}
        {section === "workspace" && <WorkspaceSection />}
        {section === "coworker" && <CoworkerSection />}
        {section === "integrations" && <IntegrationsSection />}
        {section === "notifications" && <NotificationsSection />}
        {section === "security" && <SecuritySection />}
        {section === "billing" && <BillingSection />}
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
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const providers = [
    {
      key: "google-workspace",
      name: "Google Workspace",
      description: "Gmail, Calendar, Meet, Drive, Docs, and Sheets through Google sign-in.",
      icon: Plug,
      start: "google" as const,
      button: "Sign in with Google",
    },
    {
      key: "whatsapp-cloud",
      name: "WhatsApp Business",
      description: "Official WhatsApp Business Platform connection for customer messages and approved replies.",
      note:
        "This opens Meta Business onboarding, then you choose or verify a business phone number. WhatsApp Web QR login is not used for the audited business API.",
      icon: MessageCircle,
      start: "meta" as const,
      button: "Connect WhatsApp Business",
    },
    {
      key: "quickbooks",
      name: "QuickBooks",
      description: "Customers, invoices, and accounting access through Intuit sign-in.",
      icon: Landmark,
      start: "quickbooks" as const,
      button: "Sign in with Intuit",
    },
  ];

  const startOAuth = async (provider: (typeof providers)[number]) => {
    if (!currentOrganization) return;
    try {
      const redirectUri = `${window.location.origin}/oauth/callback/${provider.start}`;
      const basePayload = {
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        redirectUri,
      };
      const result =
        provider.start === "google"
          ? await googleOAuthUrl(basePayload)
          : provider.start === "meta"
            ? await metaOAuthUrl(basePayload)
            : await quickBooksOAuthUrl(basePayload);
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
            connection?.config?.setupStatus === "ready";
          return (
            <div
              key={provider.key}
              className="rounded-lg border border-app bg-slate-900/40 p-4"
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
                  {"note" in provider && provider.note && (
                    <p className="mt-2 rounded-md border border-app bg-slate-950/60 px-2 py-1.5 text-[11px] leading-4 text-app-subtle">
                      {provider.note}
                    </p>
                  )}
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
            className="ml-auto grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-white/10"
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
                  className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-lg border border-app bg-slate-950/60 px-3 py-2 text-left hover:bg-white/5"
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
    <section className="rounded-xl border border-app bg-slate-900/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-emerald-400" />
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function ProfileSection() {
  const { user, logout } = useAppContext();
  return (
    <Card icon={User} title="Profile">
      <Field label="Name">
        <Input
          value={user ? `${user.firstName} ${user.lastName}` : ""}
          readOnly
          className="border-app bg-app-surface"
        />
      </Field>
      <Field label="Email">
        <Input value={user?.email ?? ""} readOnly className="border-app bg-app-surface" />
      </Field>
      <Button variant="outline" onClick={logout} className="gap-1">
        <LogOut className="h-3.5 w-3.5" /> Sign out
      </Button>
    </Card>
  );
}

function OrganizationSection() {
  const { currentOrganization } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentOrganization) return;
    void fetchOrganizations()
      .then((all) => {
        const org = all.find((o) => o.id === currentOrganization.id);
        if (org) setApiKey(org.openrouterApiKey ?? "");
      })
      .finally(() => setLoading(false));
  }, [currentOrganization]);

  if (!currentOrganization) {
    return <p className="text-sm text-app-faint">Select an organization first.</p>;
  }

  return (
    <Card icon={Building2} title={currentOrganization.name}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-app-faint" />
      ) : (
        <>
          <Field label="OpenRouter API key">
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-…"
              className="border-app bg-app-surface font-mono"
            />
          </Field>
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
                  openrouterApiKey: apiKey || null,
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
        </>
      )}
    </Card>
  );
}

function WorkspaceSection() {
  const { currentWorkspace } = useAppContext();
  return (
    <Card icon={Building2} title={currentWorkspace?.name ?? "Workspace"}>
      <p className="text-xs text-app-faint">—</p>
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
  return (
    <Card icon={Bell} title="Notifications">
      <p className="text-xs text-app-faint">—</p>
    </Card>
  );
}

function SecuritySection() {
  return (
    <Card icon={ShieldCheck} title="Security">
      <p className="text-xs text-app-faint">—</p>
    </Card>
  );
}

function BillingSection() {
  return (
    <Card icon={Building2} title="Billing">
      <p className="text-xs text-app-faint">—</p>
    </Card>
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
      description: "Default. Easy on the eyes for long sessions.",
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
                  ? "border-cyan-400/50 bg-cyan-500/10 text-app shadow-[0_0_0_1px_rgba(34,211,238,0.25)]"
                  : "border-app bg-app-elevated text-app-muted hover:border-app-strong hover:text-app"
              }`}
            >
              <div className="flex w-full items-center gap-2">
                <span className={`grid h-7 w-7 place-items-center rounded-lg ${
                  active ? "bg-cyan-500/20 text-cyan-300" : "bg-app-overlay text-app-muted"
                }`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-sm font-semibold">{opt.label}</span>
                {active && (
                  <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-cyan-300" />
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
