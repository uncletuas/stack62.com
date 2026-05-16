import { useEffect, useState } from "react";
import { Bell, Bot, Building2, Camera, CheckCircle2, ExternalLink, FileDown, Key, Landmark, Loader2, LogOut, Mail, MessageCircle, Monitor, Moon, Palette, Plug, Save, ShieldCheck, Smartphone, Sun, Trash2, User, X, XCircle } from "lucide-react";
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
  fetchIntegrationConnections,
  fetchOrganizations,
  fetchWhatsAppPhoneNumbers,
  googleOAuthUrl,
  metaOAuthUrl,
  quickBooksOAuthUrl,
  resendCurrentUserVerification,
  selectWhatsAppPhoneNumber,
  updateCoworker,
  updateCurrentUserProfile,
  updateOrgSettings,
  uploadCurrentUserAvatar,
  userAvatarUrl,
  type Coworker,
  type IntegrationConnection,
  type WhatsAppPhoneNumberOption,
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
  | "organization"
  | "coworker"
  | "integrations"
  | "security"
  | "billing";

const SECTIONS: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: typeof User;
}> = [
  { key: "account", label: "Account", description: "Profile and appearance", icon: User },
  { key: "organization", label: "Organization", description: "Org and workspace settings", icon: Building2 },
  { key: "coworker", label: "Coworker", description: "AI behaviour and tools", icon: Bot },
  { key: "integrations", label: "Integrations", description: "Connect Slack, Google, etc.", icon: Plug },
  { key: "security", label: "Security", description: "Sessions, MFA, audit", icon: ShieldCheck },
  { key: "billing", label: "Billing", description: "Plan, seats, invoices", icon: Landmark },
];

function normalizeSection(raw: string | undefined): SettingsSection {
  switch (raw) {
    case "profile":
    case "appearance":
    case "account":
      return "account";
    case "workspace":
    case "organization":
      return "organization";
    case "coworker":
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
                  <AppearanceSection />
                </div>
              )}
              {section === "organization" && (
                <div className="space-y-6">
                  <OrganizationSection />
                  <WorkspaceSection />
                </div>
              )}
              {section === "coworker" && <CoworkerSection />}
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
                  {"note" in provider && provider.note && (
                    <p className="mt-2 rounded-md border border-app bg-app px-2 py-1.5 text-[11px] leading-4 text-app-subtle">
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
