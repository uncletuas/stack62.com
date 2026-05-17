import { useNavigate } from "react-router";
import {
  ArrowRight,
  BarChart2,
  Bell,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
  ChevronRight,
  BrainCircuit,
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
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[700px] w-[1200px] rounded-full bg-gradient-to-br from-violet-100 via-indigo-100 to-sky-100 dark:from-violet-900/30 dark:via-indigo-900/25 dark:to-sky-900/20 blur-3xl opacity-70" />
          <div className="absolute top-20 right-0 h-[300px] w-[400px] rounded-full bg-gradient-to-bl from-amber-100/60 to-transparent dark:from-amber-900/20 blur-2xl" />
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-6 border border-indigo-200/60 dark:border-indigo-800/60">
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered business operations
          </span>
          <h1 className="text-5xl md:text-[64px] font-bold tracking-tight leading-[1.02] mb-6">
            Run your business.
            <br />
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 dark:from-indigo-400 dark:via-violet-400 dark:to-purple-400 bg-clip-text text-transparent">
              Your AI coworker handles the rest.
            </span>
          </h1>
          <p className="max-w-2xl mx-auto text-xl text-slate-600 dark:text-slate-300 mb-10 leading-relaxed">
            Stack62 is the one environment where your whole business runs —
            operations, approvals, documents, team communication — with an AI
            coworker that manages the operational load so you can focus on
            decisions that move the needle.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="px-8 text-base bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              onClick={() => navigate("/sign-up")}
            >
              Get started free <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 text-base"
              onClick={() => navigate("/pricing")}
            >
              See plans
            </Button>
          </div>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            No credit card required · Set up in minutes
          </p>

          {/* Hero visual — morning briefing from the AI coworker */}
          <div className="mt-16 mx-auto max-w-4xl">
            <Card className="overflow-hidden border-slate-200/70 dark:border-slate-800/70 shadow-2xl shadow-slate-900/10 dark:shadow-black/50">
              {/* Window chrome */}
              <div className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200/70 dark:border-slate-800/70 px-4 py-2.5 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                <div className="ml-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Stack62 — Good morning, Marcus
                </div>
              </div>

              <div className="p-6 grid md:grid-cols-5 gap-4 text-left bg-white dark:bg-slate-950/50">
                {/* Left: AI briefing + stat strip */}
                <div className="md:col-span-3 flex flex-col gap-4">
                  {/* AI greeting */}
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl rounded-tl-none px-4 py-3 text-sm text-slate-700 dark:text-slate-200 leading-relaxed max-w-xs border border-slate-200/50 dark:border-slate-800/50">
                      Good morning. I've handled <strong>8 routine tasks</strong> overnight and flagged <strong>3 things that need your call.</strong>
                    </div>
                  </div>

                  {/* Stat strip */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 py-3 border border-emerald-100 dark:border-emerald-900/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Revenue</span>
                      </div>
                      <div className="text-lg font-bold text-emerald-800 dark:text-emerald-300">+12%</div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-500">this week</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-950/40 rounded-lg px-3 py-3 border border-amber-100 dark:border-amber-900/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Bell className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">Pending</span>
                      </div>
                      <div className="text-lg font-bold text-amber-800 dark:text-amber-300">3</div>
                      <div className="text-[10px] text-amber-600 dark:text-amber-500">need your call</div>
                    </div>
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-lg px-3 py-3 border border-indigo-100 dark:border-indigo-900/50">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-[10px] font-medium text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">Done</span>
                      </div>
                      <div className="text-lg font-bold text-indigo-800 dark:text-indigo-300">8</div>
                      <div className="text-[10px] text-indigo-600 dark:text-indigo-500">by coworker</div>
                    </div>
                  </div>
                </div>

                {/* Right: Pending decision card */}
                <div className="md:col-span-2 flex flex-col justify-center">
                  <div className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800/60">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Procurement request</span>
                      <span className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 font-medium px-2 py-0.5 rounded-full">Needs you</span>
                    </div>
                    <div className="px-4 py-3 bg-white dark:bg-slate-950/40">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-0.5">Office supplies · $4,200</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">Submitted by James · 2 hours ago</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-2.5 mb-3 border border-slate-200/50 dark:border-slate-800/50 leading-relaxed">
                        <span className="font-medium text-indigo-600 dark:text-indigo-400">Coworker:</span> This is within Q3 budget. 3 similar requests approved this quarter.
                      </div>
                      <div className="flex gap-2">
                        <button className="flex-1 text-xs py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium">
                          Decline
                        </button>
                        <button className="flex-1 text-xs py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition font-medium">
                          Approve
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Trust band ───────────────────────────────────────────── */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-950/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap justify-center gap-x-10 gap-y-4">
          <TrustItem icon={<ShieldCheck className="h-4 w-4" />} label="SOC 2 Type II ready" />
          <TrustItem icon={<CheckCircle2 className="h-4 w-4" />} label="Human-in-the-loop AI" />
          <TrustItem icon={<Users className="h-4 w-4" />} label="Built for whole teams" />
          <TrustItem icon={<Zap className="h-4 w-4" />} label="Live in under 10 minutes" />
          <TrustItem icon={<ShieldCheck className="h-4 w-4" />} label="Your data stays yours" />
        </div>
      </section>

      {/* ── The shift ─────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <p className="text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-3">
            A new way to run operations
          </p>
          <h2 className="text-4xl font-bold tracking-tight mb-4">
            Stop managing tools. Start making decisions.
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
            Most executives spend 60% of their week on coordination, chasing
            updates, and routine approvals. Stack62 shifts that — your AI
            coworker runs the operations; you run the strategy.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Without Stack62 */}
          <Card className="p-8 border-slate-200/70 dark:border-slate-800/70 bg-slate-50/80 dark:bg-slate-900/40">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-6">Without Stack62</div>
            <ul className="space-y-4">
              {[
                "Scattered across 8+ tools for CRM, HR, docs, comms",
                "Chasing team updates via email and Slack threads",
                "Hours lost to routine approvals with no context",
                "Reports built manually, always a week out of date",
                "Decisions made with incomplete information",
                "New hire needs weeks before they can find anything",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-400">
                  <span className="mt-0.5 h-5 w-5 rounded-full border-2 border-slate-300 dark:border-slate-700 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          {/* With Stack62 */}
          <Card className="p-8 border-indigo-200/70 dark:border-indigo-800/40 bg-gradient-to-br from-indigo-50/80 to-violet-50/60 dark:from-indigo-950/40 dark:to-violet-950/30">
            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-6">With Stack62</div>
            <ul className="space-y-4">
              {[
                "Every business operation in one environment",
                "AI coworker surfaces what needs you, handles what doesn't",
                "Approve in seconds — coworker provides context with every request",
                "Live dashboards update automatically as your business moves",
                "Business intelligence surfaced proactively, not on request",
                "Team sees everything relevant to their role from day one",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* ── Capabilities ─────────────────────────────────────────── */}
      <section id="solutions" className="bg-slate-50/80 dark:bg-slate-900/40 py-24 border-y border-slate-200/60 dark:border-slate-800/60">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-3">
              Everything in one place
            </p>
            <h2 className="text-4xl font-bold tracking-tight mb-4">
              One AI-powered environment.<br />Every business operation.
            </h2>
            <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
              Stack62 replaces the patchwork of tools your team juggles every
              day — with a single, intelligent environment that gets smarter
              the more you use it.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            <Capability
              icon={<BrainCircuit className="h-5 w-5" />}
              accent="indigo"
              title="AI Coworker"
              body="Your always-on AI teammate that understands your business, handles routine tasks, surfaces insights, and tells you exactly what needs a human decision — and why."
            />
            <Capability
              icon={<Bell className="h-5 w-5" />}
              accent="amber"
              title="Decision Hub"
              body="All approvals, requests, and decisions in one place — each with full context and a coworker recommendation. Approve or delegate in seconds, not hours."
            />
            <Capability
              icon={<BarChart2 className="h-5 w-5" />}
              accent="emerald"
              title="Business Intelligence"
              body="Live dashboards, automated reports, and proactive alerts when metrics move. Know what's happening in your business without asking anyone."
            />
            <Capability
              icon={<Users className="h-5 w-5" />}
              accent="violet"
              title="Team Collaboration"
              body="Shared workspaces, role-based visibility, and team communication built in. Everyone sees what they need — no more, no less."
            />
            <Capability
              icon={<Zap className="h-5 w-5" />}
              accent="sky"
              title="Workflow Automation"
              body="Routine processes run automatically — notifications, follow-ups, escalations, data updates. Your coworker watches every workflow and flags anomalies."
            />
            <Capability
              icon={<FileText className="h-5 w-5" />}
              accent="rose"
              title="Documents & Reports"
              body="Proposals, contracts, reports, invoices — generated in seconds from your live business data. Word, PDF, Excel, PowerPoint — pick your format."
            />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-3">
              How it works
            </p>
            <h2 className="text-4xl font-bold tracking-tight mb-4">
              Your business on Stack62 in four steps
            </h2>
            <p className="text-lg text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
              No implementation team. No months of setup. Just describe your
              business and watch your operations come to life.
            </p>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            <HowStep
              n="01"
              icon={<MessageSquare className="h-5 w-5" />}
              title="Describe your business"
              body="Tell Stack62 how your business works in plain language — your team, your workflows, what you track, how decisions get made."
            />
            <HowStep
              n="02"
              icon={<Sparkles className="h-5 w-5" />}
              title="Coworker sets it up"
              body="Your AI coworker builds your operations environment — CRM, workflows, approval chains, dashboards — to match exactly how you work."
            />
            <HowStep
              n="03"
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="You review every change"
              body="Nothing changes without your sign-off. Every update is shown to you first with a plain-English explanation. Approve, tweak, or say no."
            />
            <HowStep
              n="04"
              icon={<TrendingUp className="h-5 w-5" />}
              title="Run and grow"
              body="Operations run live with your team. The coworker keeps watching, flagging issues, handling routine tasks, and helping you scale."
            />
          </div>
        </div>
      </section>

      {/* ── Use cases / personas ──────────────────────────────────── */}
      <section className="bg-slate-900 dark:bg-slate-950 text-white py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-400 mb-3">
              Built for leaders
            </p>
            <h2 className="text-4xl font-bold tracking-tight">
              Whatever your role, Stack62 gives you leverage
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <PersonaCard
              role="CEO / Founder"
              headline="See everything. Decide faster."
              points={[
                "Morning briefing with what needs your attention",
                "Revenue, pipeline, and team metrics in one view",
                "Strategic decisions supported by live data",
                "Coworker flags risks before they become problems",
              ]}
            />
            <PersonaCard
              role="Operations Manager"
              headline="Automate the routine. Elevate your team."
              points={[
                "Approval workflows that run without chasing",
                "Procurement, HR requests, vendor management — all in one",
                "Automations that handle follow-ups and escalations",
                "Full visibility on every process status, live",
              ]}
              highlight
            />
            <PersonaCard
              role="Team Lead"
              headline="Keep your team in sync without more meetings."
              points={[
                "Shared workspace everyone can see and use",
                "AI surfaces the right info at the right time",
                "Communication and records in the same place",
                "Onboard new teammates in hours, not weeks",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ── Integrations strip ────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-6">
          Connects to the tools you already use
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {["Slack", "WhatsApp Business", "Google Workspace", "Microsoft 365", "QuickBooks", "Gmail", "Paystack"].map((tool) => (
            <span
              key={tool}
              className="px-4 py-2 rounded-full text-sm font-medium bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 text-slate-700 dark:text-slate-300 shadow-sm"
            >
              {tool}
            </span>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          Real integrations, not duct tape — your data flows both ways.
        </p>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────── */}
      <section className="border-t border-slate-200/70 dark:border-slate-800/70 bg-slate-50/60 dark:bg-slate-900/40 py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold tracking-tight mb-4">
            Start for free. Scale when you're ready.
          </h2>
          <p className="text-lg text-slate-600 dark:text-slate-300 max-w-xl mx-auto mb-10">
            Try Stack62 with no credit card — set up your first operations
            environment and experience an AI coworker in action. Subscribe
            when it's earning its keep.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              className="px-8 text-base bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
              onClick={() => navigate("/sign-up")}
            >
              Start for free <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 text-base"
              onClick={() => navigate("/pricing")}
            >
              View pricing <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Plans from $49/month · No setup fees · Cancel anytime
          </p>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-24">
        <h2 className="text-3xl font-bold tracking-tight mb-10 text-center">
          Common questions
        </h2>
        <div className="space-y-5">
          <Faq
            q="Do I need to be technical to use Stack62?"
            a="Not at all. Stack62 is built for business owners and operators, not engineers. You describe what you need in plain English — the AI handles everything else. If you can write an email, you can run your operations on Stack62."
          />
          <Faq
            q="Will the AI make changes to my business without asking me?"
            a="Never. Every change goes through you first. The AI proposes, explains its reasoning, and waits for your approval. You're always in control — the coworker does the work, not the deciding."
          />
          <Faq
            q="Can my whole team use Stack62?"
            a="Yes — Stack62 is built for teams. Invite your team by email, assign roles, and everyone sees exactly what's relevant to their work. Role-based access means sensitive data stays with the right people."
          />
          <Faq
            q="How is Stack62 different from tools like Salesforce or Monday.com?"
            a="Those tools make you adapt your business to their structure. Stack62 adapts to your business — the AI builds the environment around how you actually work, not a rigid template. And it keeps helping as your needs evolve."
          />
          <Faq
            q="What happens to my business data?"
            a="Your data is yours — always. It lives in your isolated tenant, the AI only sees what it needs for a specific task, and every access is logged. Stack62 is designed for SOC 2 Type II compliance and will never train on your data."
          />
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-28">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-1">
          <div className="rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 px-12 py-16 text-center text-white">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDM0djItSDM0di0yaDF2LTNBM2EgMyAwIDAgMSAzMCAzMHYtMUgzMXYxYTIgMiAwIDAgMCAyIDJoMXYxaC0xdjJoMXYxaDF2LTFoMXYtMmgtMXYtMWgxem0tNiA2djJIMjh2LTJoMXYtM0EzIDMgMCAwIDEgMjUgMzR2LTFoMXYxYTIgMiAwIDAgMCAyIDJoMXYxaC0xdjJoMXYxaDF2LTFoMXYtMmgtMXYtMWgxeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
            <h2 className="relative text-4xl font-bold tracking-tight mb-4">
              Your business deserves better than spreadsheets and Slack threads.
            </h2>
            <p className="relative text-indigo-100 max-w-xl mx-auto mb-10 text-lg leading-relaxed">
              Join businesses running smarter with an AI coworker. Set up your
              environment in minutes and see the difference in your first week.
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="px-10 text-base font-semibold bg-white text-indigo-700 hover:bg-indigo-50"
              onClick={() => navigate("/sign-up")}
            >
              Start free today <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <p className="relative mt-4 text-xs text-indigo-200">
              No credit card · No setup fee · Cancel anytime
            </p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
      <span className="text-indigo-500 dark:text-indigo-400">{icon}</span>
      {label}
    </div>
  );
}

const accentMap = {
  indigo: "bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400",
  amber: "bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400",
  violet: "bg-violet-100 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400",
  sky: "bg-sky-100 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400",
  rose: "bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400",
} as const;

function Capability({
  icon,
  title,
  body,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: keyof typeof accentMap;
}) {
  return (
    <Card className="p-6 border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900/50 hover:shadow-lg hover:shadow-slate-900/5 transition-all duration-200 hover:-translate-y-0.5">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center mb-4 ${accentMap[accent]}`}>
        {icon}
      </div>
      <h3 className="font-bold tracking-tight mb-2">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {body}
      </p>
    </Card>
  );
}

function HowStep({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-indigo-600/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-xs font-mono font-semibold text-slate-400 dark:text-slate-500">{n}</span>
      </div>
      <h3 className="text-base font-bold tracking-tight mb-2">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{body}</p>
    </div>
  );
}

function PersonaCard({
  role,
  headline,
  points,
  highlight = false,
}: {
  role: string;
  headline: string;
  points: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-8 ${
        highlight
          ? "bg-indigo-600 ring-2 ring-indigo-400/30 shadow-2xl shadow-indigo-900/40"
          : "bg-slate-800/60 dark:bg-slate-800/80"
      }`}
    >
      <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${highlight ? "text-indigo-200" : "text-slate-400"}`}>
        {role}
      </div>
      <h3 className={`text-xl font-bold mb-6 leading-tight ${highlight ? "text-white" : "text-slate-100"}`}>
        {headline}
      </h3>
      <ul className="space-y-3">
        {points.map((p) => (
          <li key={p} className={`flex items-start gap-2.5 text-sm leading-relaxed ${highlight ? "text-indigo-100" : "text-slate-300"}`}>
            <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${highlight ? "text-indigo-300" : "text-indigo-400"}`} />
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-slate-200/70 dark:border-slate-800/70 pb-5">
      <summary className="flex justify-between items-center cursor-pointer list-none font-semibold text-slate-900 dark:text-slate-100 py-1">
        {q}
        <span className="ml-4 h-6 w-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 group-open:rotate-45 transition-transform duration-200 flex-shrink-0 text-sm">
          +
        </span>
      </summary>
      <p className="mt-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {a}
      </p>
    </details>
  );
}
