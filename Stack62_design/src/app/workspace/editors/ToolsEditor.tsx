import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Calendar as CalendarIcon,
  Check,
  Cloud,
  CreditCard,
  Database,
  Download,
  HardDrive,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import { appDialog } from "../../components/app-dialog";
import {
  auditExportCsvUrl,
  createIntegrationConnection,
  fetchIntegrationConnections,
  fetchIntegrationMarketplace,
  fetchIntegrationProvidersStatus,
  fetchWhatsAppPhoneNumbers,
  googleOAuthUrl,
  metaOAuthUrl,
  quickBooksOAuthUrl,
  selectWhatsAppPhoneNumber,
  verifyIntegrationConnection,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationProviderStatus,
  type WhatsAppPhoneNumberOption,
} from "../../lib/resources";
import { useWorkspace, type EditorTab } from "../workspace-context";

export function ToolsEditor({ tab }: { tab: EditorTab }) {
  const tool = tab.refId ?? "marketplace";
  return (
    <div className="h-full overflow-y-auto bg-app p-6 text-app">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex items-center gap-2 border-b border-app pb-3">
          <Wrench className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-semibold capitalize">{tool}</h1>
        </header>
        {tool === "marketplace" && <Marketplace />}
        {tool === "connections" && <Connections />}
        {tool === "audit" && <AuditTool />}
      </div>
    </div>
  );
}

const PROVIDER_ICON: Record<string, LucideIcon> = {
  email: Mail,
  smtp: Mail,
  gmail: Mail,
  outlook: AtSign,
  whatsapp: MessageCircle,
  twilio: MessageSquare,
  slack: MessageSquare,
  discord: MessageSquare,
  teams: MessageSquare,
  paystack: CreditCard,
  stripe: CreditCard,
  s3: HardDrive,
  drive: HardDrive,
  dropbox: HardDrive,
  gcs: Cloud,
  azure: Cloud,
  postgres: Database,
  webhook: Webhook,
  google_calendar: CalendarIcon,
  ical: CalendarIcon,
};

function iconFor(key: string): LucideIcon {
  const k = key.toLowerCase();
  for (const [pattern, icon] of Object.entries(PROVIDER_ICON)) {
    if (k.includes(pattern)) return icon;
  }
  return Plug;
}

const HUMAN_KEY = (k: string) =>
  k
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const OAUTH_PROVIDERS: Record<string, { label: string; start: "google" | "meta" | "quickbooks" }> = {
  "google-workspace": { label: "Connect with Google", start: "google" },
  "whatsapp-cloud": { label: "Connect WhatsApp Business", start: "meta" },
  quickbooks: { label: "Connect with Intuit", start: "quickbooks" },
};

export function Marketplace() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [status, setStatus] = useState<IntegrationProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<IntegrationProvider | null>(null);

  const reload = async () => {
    if (!currentOrganization) return;
    const [p, c, s] = await Promise.all([
      fetchIntegrationMarketplace().catch(() => []),
      fetchIntegrationConnections({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchIntegrationProvidersStatus().catch(
        () => [] as IntegrationProviderStatus[],
      ),
    ]);
    setProviders(p);
    setConnections(c);
    setStatus(s);
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

  const connectedKeys = useMemo(
    () => new Set(connections.map((c) => c.providerKey)),
    [connections],
  );
  const statusByKey = useMemo(() => {
    const m = new Map<string, IntegrationProviderStatus>();
    status.forEach((s) => m.set(s.providerKey, s));
    return m;
  }, [status]);

  const grouped = useMemo(() => {
    const filtered = providers.filter((p) => {
      const q = filter.toLowerCase();
      return (
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    });
    return filtered.reduce<Record<string, IntegrationProvider[]>>(
      (acc, cur) => {
        (acc[cur.category] ??= []).push(cur);
        return acc;
      },
      {},
    );
  }, [providers, filter]);

  if (loading) {
    return (
      <div className="grid h-64 place-items-center text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search the marketplace…"
          className="h-9 max-w-sm border-app bg-app-surface text-sm"
        />
        <span className="text-xs text-app-faint">
          {providers.length} providers · {connections.length} connected
        </span>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <p className="text-sm text-app-faint">No providers match.</p>
      ) : (
        Object.entries(grouped).map(([category, list]) => (
          <section key={category} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-subtle">
              {category}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => {
                const Icon = iconFor(p.key);
                const connected = connectedKeys.has(p.key);
                const providerStatus = statusByKey.get(p.key);
                const oauthEntry = OAUTH_PROVIDERS[p.key];
                // A provider is "unconfigured" only when (a) it uses
                // OAuth on this Stack62 deployment and (b) the status
                // endpoint says its env vars are missing. Non-OAuth
                // providers (SMTP, webhooks, etc) connect via a form
                // so the operator's env doesn't matter.
                const unconfigured =
                  !!oauthEntry &&
                  providerStatus !== undefined &&
                  !providerStatus.configured;
                return (
                  <div
                    key={p.key}
                    className={`flex flex-col rounded-xl border border-app bg-app-elevated/50 p-4 ${
                      unconfigured ? "opacity-70" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {p.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-app-faint">
                          {p.category}
                        </p>
                      </div>
                      {connected ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                          <Check className="h-3 w-3" /> connected
                        </span>
                      ) : unconfigured ? (
                        <span
                          className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                          title={`Operator hasn't set: ${providerStatus?.missing.join(", ")}`}
                        >
                          not configured
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-app-subtle">
                      {p.description}
                    </p>
                    {p.key === "whatsapp-cloud" && (
                      <p className="mt-2 rounded-md border border-app bg-app px-2 py-1.5 text-[11px] leading-4 text-app-subtle">
                        Official WhatsApp Business setup opens Meta Business onboarding. QR login is for WhatsApp Web sessions, not the audited Cloud API integration.
                      </p>
                    )}
                    {p.capabilities.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.capabilities.slice(0, 4).map((c) => (
                          <span
                            key={c}
                            className="rounded bg-app-elevated px-1.5 py-0.5 text-[10px] text-app-muted"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant={connected ? "outline" : "default"}
                        className="gap-1"
                        disabled={unconfigured && !connected}
                        title={
                          unconfigured
                            ? `${p.name} sign-in is not configured for this Stack62 app. Operator needs to set ${providerStatus?.missing.join(", ")}.`
                            : undefined
                        }
                        onClick={async () => {
                          const oauth = OAUTH_PROVIDERS[p.key];
                          if (!oauth) {
                            setActive(p);
                            return;
                          }
                          if (unconfigured && providerStatus) {
                            await appDialog.alert({
                              title: `${p.name} is not configured`,
                              description: `Your Stack62 operator hasn't set up this provider yet. They need to set these env vars on the API service: ${providerStatus.missing.join(", ")}. Then redeploy and try again.`,
                              tone: "info",
                            });
                            return;
                          }
                          if (!currentOrganization) return;
                          try {
                            const redirectUri = `${window.location.origin}/oauth/callback/${oauth.start}`;
                            const result =
                              oauth.start === "google"
                                ? await googleOAuthUrl({
                                    organizationId: currentOrganization.id,
                                    workspaceId: currentWorkspace?.id,
                                    redirectUri,
                                  })
                                : oauth.start === "quickbooks"
                                  ? await quickBooksOAuthUrl({
                                      organizationId: currentOrganization.id,
                                      workspaceId: currentWorkspace?.id,
                                      redirectUri,
                                    })
                                : await metaOAuthUrl({
                                    organizationId: currentOrganization.id,
                                    workspaceId: currentWorkspace?.id,
                                    redirectUri,
                                  });
                            window.open(result.url, "stack62_integration_oauth", "width=720,height=760");
                            appendRunLog({
                              level: "ok",
                              text: `Opened ${p.name} sign-in in a new tab`,
                              source: "integrations",
                            });
                          } catch (err) {
                            appendRunLog({
                              level: "warn",
                              text: `${p.name} sign-in is not ready: ${(err as Error).message}`,
                              source: "integrations",
                            });
                          }
                        }}
                      >
                        <Plug className="h-3.5 w-3.5" />
                        {OAUTH_PROVIDERS[p.key]
                          ? OAUTH_PROVIDERS[p.key].label
                          : connected
                            ? "Add another"
                            : "Connect"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {active && (
        <ConnectionDialog
          provider={active}
          onClose={() => setActive(null)}
          onSaved={async (created) => {
            setConnections((cur) => [created, ...cur]);
            appendRunLog({
              level: "ok",
              text: `Connected ${active.name}`,
              source: "tools",
            });
            setActive(null);
          }}
        />
      )}
    </>
  );
}

function ConnectionDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: IntegrationProvider;
  onClose: () => void;
  onSaved: (c: IntegrationConnection) => void | Promise<void>;
}) {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [name, setName] = useState(provider.name);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const setVal = (
    setter: typeof setConfig,
    key: string,
    value: string,
  ) => setter((cur) => ({ ...cur, [key]: value }));

  const submit = async () => {
    if (!currentOrganization) return;
    setBusy(true);
    try {
      const created = await createIntegrationConnection({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
        providerKey: provider.key,
        name: name || provider.name,
        config: Object.fromEntries(
          Object.entries(config).filter(([, v]) => v !== ""),
        ),
        credentials: Object.fromEntries(
          Object.entries(credentials).filter(([, v]) => v !== ""),
        ),
      });
      try {
        const verify = await verifyIntegrationConnection(created.id);
        appendRunLog({
          level: verify.ok ? "ok" : "warn",
          text: `${provider.name}: ${verify.message}`,
          source: "tools",
        });
      } catch {
        /* non-fatal */
      }
      await onSaved(created);
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Connect failed: ${(err as Error).message}`,
        source: "tools",
      });
    } finally {
      setBusy(false);
    }
  };

  const Icon = iconFor(provider.key);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-app-strong bg-app-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-app px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Connect {provider.name}</p>
            <p className="text-[11px] text-app-faint">{provider.category}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-app-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <Field label="Connection name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-app bg-app"
                placeholder={`e.g. Marketing ${provider.name}`}
              />
            </Field>

            {provider.configFields.length > 0 && (
              <FieldGroup label="Configuration">
                {provider.configFields.map((f) => (
                  <Field key={f} label={HUMAN_KEY(f)}>
                    <Input
                      value={config[f] ?? ""}
                      onChange={(e) => setVal(setConfig, f, e.target.value)}
                      className="border-app bg-app"
                      placeholder={f}
                    />
                  </Field>
                ))}
              </FieldGroup>
            )}

            {provider.credentialFields.length > 0 && (
              <FieldGroup label="Credentials" sensitive>
                {provider.credentialFields.map((f) => (
                  <Field key={f} label={HUMAN_KEY(f)}>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={credentials[f] ?? ""}
                      onChange={(e) =>
                        setVal(setCredentials, f, e.target.value)
                      }
                      className="border-app bg-app font-mono"
                      placeholder={f}
                    />
                  </Field>
                ))}
              </FieldGroup>
            )}

          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-app bg-app px-4 py-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void submit()}
              className="gap-1"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              Connect
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function Connections() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [conns, setConns] = useState<IntegrationConnection[]>([]);
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [phonePicker, setPhonePicker] = useState<{
    connection: IntegrationConnection;
    numbers: WhatsAppPhoneNumberOption[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!currentOrganization) return;
    setLoading(true);
    const [c, p] = await Promise.all([
      fetchIntegrationConnections({
        organizationId: currentOrganization.id,
        workspaceId: currentWorkspace?.id,
      }).catch(() => []),
      fetchIntegrationMarketplace().catch(() => []),
    ]);
    setConns(c);
    setProviders(p);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id, currentWorkspace?.id]);

  const providerByKey = useMemo(
    () => new Map(providers.map((p) => [p.key, p])),
    [providers],
  );

  if (loading) {
    return (
      <div className="grid h-64 place-items-center text-app-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (conns.length === 0) {
    return (
      <p className="text-sm text-app-faint">No connections.</p>
    );
  }

  return (
    <div className="space-y-3">
      {conns.map((c) => {
        const provider = providerByKey.get(c.providerKey);
        const Icon = iconFor(c.providerKey);
        return (
          <div
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-app bg-app-hover p-4"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-300">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="text-[11px] text-app-faint">
                {provider?.name ?? c.providerKey}
                {typeof c.config?.displayPhoneNumber === "string"
                  ? ` · ${c.config.displayPhoneNumber}`
                  : typeof c.config?.setupStatus === "string"
                    ? ` · ${HUMAN_KEY(c.config.setupStatus)}`
                    : ""}
                {c.lastCheckedAt
                  ? ` · checked ${new Date(c.lastCheckedAt).toLocaleString()}`
                  : ""}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                c.status === "active" || c.status === "connected"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : c.status === "error"
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-app-elevated text-app-muted"
              }`}
            >
              {c.status}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={async () => {
                try {
                  const result = await verifyIntegrationConnection(c.id);
                  appendRunLog({
                    level: result.ok ? "ok" : "warn",
                    text: `${c.name}: ${result.message}`,
                    source: "tools",
                  });
                  void reload();
                } catch (err) {
                  appendRunLog({
                    level: "error",
                    text: `Verify failed: ${(err as Error).message}`,
                    source: "tools",
                  });
                }
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Verify
            </Button>
            {c.providerKey === "whatsapp-cloud" && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={async () => {
                  try {
                    const result = await fetchWhatsAppPhoneNumbers(c.id);
                    setPhonePicker({
                      connection: c,
                      numbers: result.phoneNumbers,
                    });
                    if (result.phoneNumbers.length === 0) {
                      appendRunLog({
                        level: "warn",
                        text: "No WhatsApp Business phone numbers were found for this Meta account",
                        source: "integrations",
                      });
                    }
                  } catch (err) {
                    appendRunLog({
                      level: "error",
                      text: `Could not load WhatsApp numbers: ${(err as Error).message}`,
                      source: "integrations",
                    });
                  }
                }}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Number
              </Button>
            )}
          </div>
        );
      })}
      {phonePicker && (
        <WhatsAppNumberDialog
          connection={phonePicker.connection}
          numbers={phonePicker.numbers}
          onClose={() => setPhonePicker(null)}
          onSelect={async (number) => {
            try {
              const updated = await selectWhatsAppPhoneNumber(
                phonePicker.connection.id,
                {
                  phoneNumberId: number.id,
                  displayPhoneNumber: number.displayPhoneNumber,
                  verifiedName: number.verifiedName,
                  businessAccountId: number.businessAccountId,
                },
              );
              appendRunLog({
                level: "ok",
                text: `WhatsApp will send from ${number.displayPhoneNumber}`,
                source: "integrations",
              });
              setConns((cur) =>
                cur.map((item) => (item.id === updated.id ? updated : item)),
              );
              setPhonePicker(null);
            } catch (err) {
              appendRunLog({
                level: "error",
                text: `Selection failed: ${(err as Error).message}`,
                source: "integrations",
              });
            }
          }}
        />
      )}
    </div>
  );
}

function WhatsAppNumberDialog({
  connection,
  numbers,
  onClose,
  onSelect,
}: {
  connection: IntegrationConnection;
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
        className="w-full max-w-lg overflow-hidden rounded-xl border border-app-strong bg-app-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-app px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Choose WhatsApp number</p>
            <p className="text-[11px] text-app-faint">{connection.name}</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded text-app-subtle hover:bg-app-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {numbers.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-app-faint">
              No WhatsApp Business phone numbers were found for this account.
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

function AuditTool() {
  const { currentOrganization, currentWorkspace } = useAppContext();
  return (
    <Button
      disabled={!currentOrganization}
      onClick={() => {
        if (!currentOrganization) return;
        window.open(
          auditExportCsvUrl({
            organizationId: currentOrganization.id,
            workspaceId: currentWorkspace?.id,
          }),
          "_blank",
        );
      }}
      className="gap-1"
    >
      <Download className="h-4 w-4" /> Download CSV
    </Button>
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

function FieldGroup({
  label,
  sensitive,
  children,
}: {
  label: string;
  sensitive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-app bg-app p-3">
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-app-faint">
        {label}
        {sensitive && (
          <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            <ShieldCheck className="h-3 w-3" /> sensitive
          </span>
        )}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
