import { useNavigate } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Layers,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { PublicShell } from "./PublicShell";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <PublicShell>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[640px] w-[1100px] rounded-full bg-gradient-to-br from-indigo-100 via-fuchsia-100 to-amber-100 dark:from-indigo-900/40 dark:via-fuchsia-900/30 dark:to-amber-900/30 blur-3xl opacity-60" />
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/5 dark:bg-white/10 text-xs font-medium text-slate-700 dark:text-slate-200 mb-6 backdrop-blur-sm border border-slate-200/60 dark:border-white/10">
            <Sparkles className="h-3.5 w-3.5" />
            Replit for business systems
          </span>
          <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-6">
            Describe a system.
            <br />
            <span className="bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-slate-200 dark:to-slate-400 bg-clip-text text-transparent">
              Stack62 builds it. You and the AI run it together.
            </span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg text-slate-600 dark:text-slate-300 mb-10 leading-relaxed">
            CRM, finance, operations, HR — Stack62 drafts the system to your
            business, deploys it on the platform, and stays as a coworker that
            proposes, you approve, every change.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="px-7 text-base"
              onClick={() => navigate("/sign-up")}
            >
              Start free <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-7 text-base"
              onClick={() => navigate("/pricing")}
            >
              See plans
            </Button>
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            No credit card required. One of each AI feature on the house.
          </p>

          {/* Hero visual — fake "approve this change" frame */}
          <div className="mt-16 mx-auto max-w-4xl">
            <Card className="overflow-hidden border-slate-200/70 dark:border-slate-800/70 shadow-2xl shadow-slate-900/5 dark:shadow-black/40">
              <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200/70 dark:border-slate-800/70 px-4 py-2 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <div className="ml-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
                  Stack62 — Coworker
                </div>
              </div>
              <div className="p-6 text-left grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Coworker proposes
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed mb-4">
                    Add a "VIP" segment to the CRM. Customers with{" "}
                    <span className="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">
                      lifetime_value &gt; $5,000
                    </span>{" "}
                    auto-route to Sarah.
                  </p>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    3 files changed · 0 destructive · safe to apply
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 border border-slate-200/60 dark:border-slate-800/60 font-mono text-xs leading-6">
                  <div className="text-slate-400">{"// system-definition.json"}</div>
                  <div>
                    <span className="text-slate-400">+ </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      "vip_segment": {"{"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">+ </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      &nbsp;&nbsp;"rule": "lifetime_value &gt; 5000",
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">+ </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      &nbsp;&nbsp;"owner": "sarah@acme.com"
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">+ </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {"}"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="border-t border-slate-200/70 dark:border-slate-800/70 px-6 py-3 flex items-center justify-between bg-white dark:bg-slate-950/40">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Plan → Diff → Approve
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost">
                    Reject
                  </Button>
                  <Button size="sm">Approve & apply</Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Trust band ───────────────────────────────────────────── */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white/40 dark:bg-slate-950/40">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-xs text-slate-500 dark:text-slate-400 text-center">
          <TrustItem icon={<ShieldCheck className="h-4 w-4" />} label="SOC 2 Type II ready" />
          <TrustItem icon={<GitBranch className="h-4 w-4" />} label="Git-style audit trail" />
          <TrustItem icon={<Layers className="h-4 w-4" />} label="Multi-tenant isolation" />
          <TrustItem icon={<CheckCircle2 className="h-4 w-4" />} label="Human-in-the-loop AI" />
        </div>
      </section>

      {/* ── Product capabilities ─────────────────────────────────── */}
      <section id="product" className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <p className="text-sm font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            What ships with Stack62
          </p>
          <h2 className="text-4xl font-semibold tracking-tight">
            One platform. Every business system.
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
            Stack62 ships the systems most teams cobble together —{" "}
            CRM, finance, operations, HR, projects — and lets you reshape any
            of them in plain English.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="Coworker AI"
            body="A teammate that proposes changes, drafts replies, summarizes activity. Every action diffs first."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Plan → Diff → Approve"
            body="The AI never silently mutates your system. Every change is a reviewable plan with a confidence score."
          />
          <Feature
            icon={<Workflow className="h-5 w-5" />}
            title="Workflow automation"
            body="Triggers, filters, actions — built once, tied to your data, watched by the same Coworker."
          />
          <Feature
            icon={<Layers className="h-5 w-5" />}
            title="Multi-tenant by default"
            body="Organizations, workspaces, role-based access — designed for teams from day one."
          />
          <Feature
            icon={<GitBranch className="h-5 w-5" />}
            title="Real integrations"
            body="Gmail, Google Workspace, WhatsApp Business, QuickBooks, Slack, Microsoft 365 — connected, not pretended."
          />
          <Feature
            icon={<ScrollText className="h-5 w-5" />}
            title="Audit-grade history"
            body="Every read, every approval, every AI tool-call — logged with retention you control."
          />
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section
        id="how-it-works"
        className="bg-slate-900 text-white py-24 -mx-0"
      >
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400 mb-3">
              The Stack62 loop
            </p>
            <h2 className="text-4xl font-semibold tracking-tight">
              Describe. Diff. Approve. Ship.
            </h2>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            <Step
              n="01"
              title="Describe"
              body="Tell Stack62 what your business needs. Plain language is fine — no schemas to learn."
            />
            <Step
              n="02"
              title="Plan"
              body="The Coworker drafts a change plan with a confidence score and a list of exactly what would happen."
            />
            <Step
              n="03"
              title="Approve"
              body="Review the diff like a pull request. Tweak. Reject. Approve. You're always in the loop."
            />
            <Step
              n="04"
              title="Ship"
              body="Approved changes apply to your live system. The Coworker keeps watching, suggesting, helping."
            />
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ──────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <h2 className="text-4xl font-semibold tracking-tight mb-4">
          Free to try. Pay when you scale.
        </h2>
        <p className="text-slate-600 dark:text-slate-300 max-w-xl mx-auto mb-10">
          Get one of each AI feature for free — generate a plan, draft a doc,
          deploy a system. Subscribe when you want to go further.
        </p>
        <Button
          size="lg"
          variant="outline"
          onClick={() => navigate("/pricing")}
        >
          See all plans <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-semibold tracking-tight mb-10 text-center">
          Frequently asked
        </h2>
        <div className="space-y-6">
          <Faq
            q="Is the AI making changes without me?"
            a="Never. Stack62's design principle is Plan → Diff → Approve. Every AI-proposed change becomes a reviewable plan you explicitly approve. The audit log records who approved what, when."
          />
          <Faq
            q="Can my team collaborate inside Stack62?"
            a="Yes — organizations, workspaces, and roles are built in. Invite teammates by email; each member sees only what their role permits. The Coworker shares org-wide context but keeps personal preferences private."
          />
          <Faq
            q="What happens to my data?"
            a="Your data lives in your tenant. The AI sees only what it needs for the current task, with all reads and writes logged. Stack62 is designed for SOC 2 Type II from day one."
          />
          <Faq
            q="Can I export my system?"
            a="Yes. Every system on Stack62 is described by a JSON system-definition you can export, version, and reapply. No lock-in."
          />
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-24 text-center">
        <Card className="p-12 border-slate-200/70 dark:border-slate-800/70 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950">
          <h2 className="text-3xl font-semibold tracking-tight mb-3">
            Ready to put your business on Stack62?
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-8">
            Sign up in under a minute. Start with one AI-drafted system on the
            house.
          </p>
          <Button size="lg" onClick={() => navigate("/sign-up")}>
            Get started <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </Card>
      </section>
    </PublicShell>
  );
}

function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-emerald-500">{icon}</span>
      <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="p-6 border-slate-200/70 dark:border-slate-800/70 hover:shadow-lg hover:shadow-slate-900/5 transition-shadow">
      <div className="h-10 w-10 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-semibold tracking-tight mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {body}
      </p>
    </Card>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <div className="text-xs font-mono text-slate-400 mb-3">{n}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-slate-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-slate-200/70 dark:border-slate-800/70 pb-5">
      <summary className="flex justify-between items-center cursor-pointer list-none font-medium text-slate-900 dark:text-slate-100">
        {q}
        <span className="ml-4 text-slate-400 group-open:rotate-45 transition-transform">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {a}
      </p>
    </details>
  );
}
