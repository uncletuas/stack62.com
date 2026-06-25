import { useNavigate } from "react-router";
import {
  ArrowRight,
  Bot,
  FileText,
  GitPullRequest,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { PublicShell } from "./PublicShell";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <PublicShell>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* single, restrained glow — one accent, no rainbow */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 -top-48 h-[640px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-[140px] dark:bg-indigo-500/20" />
        </div>

        <div className="mx-auto max-w-3xl px-6 pt-28 pb-12 text-center">

          <h1 className="mb-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-[68px]">
            Describe your business.
            <br />
            <span className="text-indigo-600 dark:text-indigo-400">
              Watch it run itself.
            </span>
          </h1>

          <p className="mx-auto mb-9 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            Stack62 turns plain-English descriptions into real business
            systems — CRM, finance, HR, operations — and keeps them running
            with an AI coworker. You approve every change. It handles the rest.
          </p>

          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="bg-indigo-600 px-8 text-base hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              onClick={() => navigate("/sign-up")}
            >
              Start free <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 text-base"
              onClick={() => navigate("/pricing")}
            >
              See pricing
            </Button>
          </div>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Free forever plan · No credit card · Live in minutes
          </p>
        </div>

        {/* Hero visual — the coworker's morning briefing, mono-indigo */}
        <div className="mx-auto max-w-3xl px-6 pb-8">
          <HeroPreview />
        </div>
      </section>

      {/* ── Trust line ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Connects to the tools you already run on
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-slate-500 dark:text-slate-400">
          {[
            "WhatsApp Business",
            "Google Workspace",
            "Microsoft 365",
            "QuickBooks",
            "Gmail",
            "Paystack",
          ].map((tool) => (
            <span key={tool}>{tool}</span>
          ))}
        </div>
      </section>

      {/* ── The core loop (the differentiator) ────────────────────── */}
      <section id="how" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
            How it works
          </p>
          <h2 className="mb-4 text-4xl font-bold tracking-tight">
            AI does the work. You stay in control.
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-300">
            Every change your coworker makes is planned, explained, and shown
            to you before anything happens. Nothing ships without your approval.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <LoopStep
            n="01"
            title="Describe"
            body="Tell Stack62 how your business works in plain language. Your coworker drafts the systems, workflows, and dashboards to match."
          />
          <LoopStep
            n="02"
            title="Review & approve"
            body="See a plain-English plan and a clear diff of exactly what will change. Approve it, tweak it, or say no — you decide."
          />
          <LoopStep
            n="03"
            title="It runs — live"
            body="Your systems run on Stack62 with your team. The coworker keeps watching, handling routine work and flagging what needs you."
          />
        </div>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────── */}
      <section
        id="features"
        className="border-y border-slate-200/70 bg-slate-50/60 py-24 dark:border-slate-800/70 dark:bg-slate-900/30"
      >
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
              One environment
            </p>
            <h2 className="mb-4 text-4xl font-bold tracking-tight">
              Everything your business runs on, in one place
            </h2>
            <p className="text-lg text-slate-600 dark:text-slate-300">
              Stack62 replaces the patchwork of tools your team juggles — with
              a single intelligent environment that gets smarter as you use it.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-200/70 dark:border-slate-800/70 dark:bg-slate-800/70 md:grid-cols-2">
            <Feature
              icon={<Bot className="h-5 w-5" />}
              title="AI Coworker"
              body="An always-on teammate that understands your business, handles routine tasks, and tells you exactly what needs a human decision — and why."
            />
            <Feature
              icon={<GitPullRequest className="h-5 w-5" />}
              title="Systems that keep running"
              body="CRM, finance, HR, procurement — drafted from a prompt and run live on Stack62. Not throwaway scaffolding; real software that evolves."
            />
            <Feature
              icon={<LayoutDashboard className="h-5 w-5" />}
              title="Decisions & intelligence"
              body="Approvals, requests, and live dashboards in one place — each with full context and a coworker recommendation. Decide in seconds."
            />
            <Feature
              icon={<FileText className="h-5 w-5" />}
              title="Documents & communication"
              body="Proposals, reports, and invoices generated from live data, plus team chat, email, and WhatsApp — all in the same workspace."
            />
          </div>
        </div>
      </section>

      {/* ── Pricing teaser ────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="mb-4 text-4xl font-bold tracking-tight">
          Start free. Scale when it earns its keep.
        </h2>
        <p className="mx-auto mb-9 max-w-lg text-lg text-slate-600 dark:text-slate-300">
          Build your first system and meet your AI coworker with no credit
          card. Upgrade only when your team needs more.
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="bg-indigo-600 px-8 text-base hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            onClick={() => navigate("/sign-up")}
          >
            Start free <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-8 text-base"
            onClick={() => navigate("/pricing")}
          >
            View plans
          </Button>
        </div>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Free forever · Paid plans from $19 / seat / month · Cancel anytime
        </p>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-2xl px-6 pb-24">
        <h2 className="mb-10 text-center text-3xl font-bold tracking-tight">
          Common questions
        </h2>
        <div className="space-y-1">
          <Faq
            q="Do I need to be technical?"
            a="No. Stack62 is built for business owners and operators, not engineers. You describe what you need in plain English and the AI handles the rest. If you can write an email, you can run your operations here."
          />
          <Faq
            q="Will the AI change things without asking me?"
            a="Never. Every change is planned, explained, and shown to you as a clear diff before anything happens. The coworker proposes; you approve. You're always in control."
          />
          <Faq
            q="How is this different from Salesforce or Monday.com?"
            a="Those tools make you adapt your business to their structure. Stack62 builds the environment around how you actually work — from a prompt — and keeps improving it as your needs change."
          />
          <Faq
            q="What happens to my business data?"
            a="It's yours, always. It lives in your isolated tenant, the AI only sees what a task needs, every access is logged, and we never train on your data."
          />
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-28">
        <div className="relative overflow-hidden rounded-3xl bg-slate-900 px-8 py-16 text-center dark:bg-slate-900/80 dark:ring-1 dark:ring-slate-800">
          <div className="pointer-events-none absolute left-1/2 -top-24 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-600/30 blur-[100px]" />
          <h2 className="relative mb-4 text-4xl font-bold tracking-tight text-white">
            Your business deserves a coworker, not more tabs.
          </h2>
          <p className="relative mx-auto mb-9 max-w-lg text-lg leading-relaxed text-slate-300">
            Set up your environment in minutes and see the difference in your
            first week.
          </p>
          <Button
            size="lg"
            className="relative bg-white px-10 text-base font-semibold text-slate-900 hover:bg-slate-100"
            onClick={() => navigate("/sign-up")}
          >
            Start free today <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
          <p className="relative mt-4 text-xs text-slate-400">
            No credit card · No setup fee · Cancel anytime
          </p>
        </div>
      </section>
    </PublicShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function HeroPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl shadow-slate-900/10 dark:border-slate-800/70 dark:bg-slate-950/60 dark:shadow-black/40">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-slate-200/70 bg-slate-50 px-4 py-2.5 dark:border-slate-800/70 dark:bg-slate-900/70">
        <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
        <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
        <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
        <div className="ml-3 text-xs font-medium text-slate-400 dark:text-slate-500">
          Stack62 — Good morning, Marcus
        </div>
      </div>

      <div className="grid gap-4 bg-white p-5 text-left dark:bg-slate-950/40 md:grid-cols-5">
        {/* coworker briefing */}
        <div className="flex flex-col gap-4 md:col-span-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="max-w-sm rounded-xl rounded-tl-none border border-slate-200/60 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 dark:border-slate-800/60 dark:bg-slate-900/60 dark:text-slate-200">
              Good morning. I handled <strong>8 routine tasks</strong> overnight
              and flagged <strong>3 things</strong> that need your call.
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <Stat label="Done by coworker" value="8" />
            <Stat label="Need your call" value="3" />
            <Stat label="Revenue · week" value="+12%" />
          </div>
        </div>

        {/* a pending decision (the Plan→Approve moment) */}
        <div className="flex flex-col justify-center md:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800/80">
            <div className="flex items-center justify-between border-b border-slate-200/60 bg-slate-50 px-4 py-2.5 dark:border-slate-800/60 dark:bg-slate-900/60">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Procurement request
              </span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                Needs you
              </span>
            </div>
            <div className="bg-white px-4 py-3 dark:bg-slate-950/40">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Office supplies · $4,200
              </div>
              <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Submitted by James · 2h ago
              </div>
              <div className="mb-3 rounded-lg border border-slate-200/50 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800/50 dark:bg-slate-900/50 dark:text-slate-300">
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  Coworker:
                </span>{" "}
                Within Q3 budget. 3 similar requests approved this quarter.
              </div>
              <div className="flex gap-2">
                <button className="flex-1 rounded-md border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
                  Decline
                </button>
                <button className="flex-1 rounded-md bg-indigo-600 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700">
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800/70 dark:bg-slate-900/40">
      <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
    </div>
  );
}

function LoopStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-7 dark:border-slate-800/70 dark:bg-slate-900/40">
      <div className="mb-4 font-mono text-sm font-semibold text-indigo-500 dark:text-indigo-400">
        {n}
      </div>
      <h3 className="mb-2 text-lg font-bold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {body}
      </p>
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
    <div className="bg-white p-7 transition-colors hover:bg-slate-50/60 dark:bg-slate-950/40 dark:hover:bg-slate-900/40">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
        {icon}
      </div>
      <h3 className="mb-2 text-base font-bold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {body}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-slate-200/70 py-4 dark:border-slate-800/70">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 font-semibold text-slate-900 dark:text-slate-100">
        {q}
        <span className="ml-4 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500 transition-transform duration-200 group-open:rotate-45 dark:bg-slate-800 dark:text-slate-400">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {a}
      </p>
    </details>
  );
}
