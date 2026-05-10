import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  User,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useAppContext } from "../context/app-context";
import { GoogleButton } from "./GoogleButton";
import { PublicShell } from "./PublicShell";

export function SignUpChooser() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("inviteToken") || undefined;

  return (
    <PublicShell>
      <div className="max-w-3xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold tracking-tight mb-3">
            How will you use Stack62?
          </h1>
          <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            Pick the path that fits. You can always invite teammates later, or
            spin up a separate org for a different business.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <ChoiceCard
            icon={<User className="h-6 w-6" />}
            heading="Just me"
            description="A personal Stack62 account for solo work or trying it out."
            cta="Continue as individual"
            onClick={() =>
              navigate({
                pathname: "/sign-up/individual",
                search: inviteToken ? `?inviteToken=${inviteToken}` : "",
              })
            }
          />
          <ChoiceCard
            icon={<Building2 className="h-6 w-6" />}
            heading="My team / organization"
            description="Create a Stack62 workspace for your business and invite your team."
            cta="Set up for my team"
            onClick={() =>
              navigate({
                pathname: "/sign-up/organization",
                search: inviteToken ? `?inviteToken=${inviteToken}` : "",
              })
            }
            highlight
          />
        </div>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-10">
          Already have an account?{" "}
          <Link
            to="/sign-in"
            className="font-medium text-slate-900 dark:text-white hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}

function ChoiceCard({
  icon,
  heading,
  description,
  cta,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  heading: string;
  description: string;
  cta: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`p-7 cursor-pointer transition-all hover:shadow-xl hover:-translate-y-0.5 border ${
        highlight
          ? "border-slate-900 dark:border-white shadow-lg"
          : "border-slate-200 dark:border-slate-800"
      }`}
      onClick={onClick}
    >
      <div className="h-12 w-12 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center mb-5">
        {icon}
      </div>
      <h3 className="text-xl font-semibold tracking-tight mb-2">{heading}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
        {description}
      </p>
      <div className="flex items-center text-sm font-medium text-slate-900 dark:text-white">
        {cta} <ArrowRight className="ml-1.5 h-4 w-4" />
      </div>
    </Card>
  );
}

// ── Individual flow ─────────────────────────────────────────────────────

export function SignUpIndividual() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("inviteToken") || undefined;
  const { register } = useAppContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({ ...form, accountType: "individual", inviteToken });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="max-w-md mx-auto px-6 py-16">
        <Link
          to="/sign-up"
          className="text-sm text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Choose a different path
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mt-4 mb-2">
          Create your personal account
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          One of each AI feature on the house. No card required.
        </p>

        <GoogleButton
          intent="signup_individual"
          inviteToken={inviteToken}
          label="Sign up with Google"
          className="mb-4"
        />
        <Divider />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, firstName: e.target.value }))
                }
                required
                className="h-11"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lastName: e.target.value }))
                }
                required
                className="h-11"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              className="h-11"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) =>
                setForm((f) => ({ ...f, password: e.target.value }))
              }
              required
              className="h-11"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Minimum 8 characters.
            </p>
          </div>
          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}
          <Button type="submit" className="w-full h-11" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-xs text-center text-slate-500 dark:text-slate-400">
            By continuing, you agree to Stack62's Terms and Privacy Policy.
          </p>
        </form>
      </div>
    </PublicShell>
  );
}

// ── Organization flow ───────────────────────────────────────────────────

const ROLE_OPTIONS = [
  "Founder / CEO",
  "Operations",
  "Engineering / IT",
  "Finance",
  "People / HR",
  "Sales / Marketing",
  "Product",
  "Other",
];

const TEAM_SIZE_OPTIONS = [
  { label: "Just me — for now", value: 1 },
  { label: "2–5 people", value: 5 },
  { label: "6–25 people", value: 25 },
  { label: "26–100 people", value: 100 },
  { label: "100+ people", value: 500 },
];

export function SignUpOrganization() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("inviteToken") || undefined;
  const { register } = useAppContext();
  const [step, setStep] = useState<1 | 2>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    role: "",
    email: "",
    password: "",
    organizationName: "",
    teamSize: 5,
  });

  const handleNext = (e: FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.role) return;
    setStep(2);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        accountType: "organization",
        organizationName: form.organizationName,
        organizationRole: form.role,
        organizationTeamSize: form.teamSize,
        inviteToken,
      });
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      <div className="max-w-md mx-auto px-6 py-16">
        <Link
          to="/sign-up"
          className="text-sm text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Choose a different path
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mt-4 mb-2">
          Set up Stack62 for your team
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          Step {step} of 2 ·{" "}
          {step === 1 ? "About you" : "About your organization"}
        </p>

        {step === 1 && (
          <>
            <GoogleButton
              intent="signup_organization"
              inviteToken={inviteToken}
              organizationName={form.organizationName || undefined}
              organizationRole={form.role || undefined}
              organizationTeamSize={form.teamSize}
              label="Sign up with Google"
              className="mb-4"
            />
            <Divider />

            <form onSubmit={handleNext} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, firstName: e.target.value }))
                    }
                    required
                    className="h-11"
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, lastName: e.target.value }))
                    }
                    required
                    className="h-11"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="role">Your role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger id="role" className="h-11">
                    <SelectValue placeholder="Pick the closest match" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  required
                  className="h-11"
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Use your work email so teammates can find you.
                </p>
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  required
                  className="h-11"
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11"
                disabled={!form.firstName || !form.lastName || !form.role}
              >
                Continue <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="organizationName">Organization name</Label>
              <Input
                id="organizationName"
                value={form.organizationName}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    organizationName: e.target.value,
                  }))
                }
                required
                placeholder="Acme Co."
                className="h-11"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="teamSize">Team size</Label>
              <Select
                value={String(form.teamSize)}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, teamSize: Number(v) }))
                }
              >
                <SelectTrigger id="teamSize" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_SIZE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={String(t.value)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                We'll suggest a plan that fits.
              </p>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/60 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              You'll be the owner — you can invite teammates after sign-up.
            </div>
            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-11"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button
                type="submit"
                className="flex-1 h-11"
                disabled={submitting}
              >
                {submitting ? "Creating…" : "Create organization"}
              </Button>
            </div>
            <p className="text-xs text-center text-slate-500 dark:text-slate-400">
              By continuing, you agree to Stack62's Terms and Privacy Policy.
            </p>
          </form>
        )}
      </div>
    </PublicShell>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────

function Divider() {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-slate-200 dark:border-slate-800" />
      </div>
      <div className="relative flex justify-center text-xs uppercase tracking-wider">
        <span className="bg-white dark:bg-slate-950 px-3 text-slate-500 dark:text-slate-400">
          or with email
        </span>
      </div>
    </div>
  );
}

// Re-exports for the router so we can also keep the old route entry.
export function SignUpRouted() {
  const { variant } = useParams();
  if (variant === "individual") return <SignUpIndividual />;
  if (variant === "organization") return <SignUpOrganization />;
  return <SignUpChooser />;
}

// Auto-redirect if already authed.
export function SignUpGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isBootstrapping } = useAppContext();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isBootstrapping && isAuthenticated) {
      navigate("/app", { replace: true });
    }
  }, [isAuthenticated, isBootstrapping, navigate]);
  return <>{children}</>;
}
