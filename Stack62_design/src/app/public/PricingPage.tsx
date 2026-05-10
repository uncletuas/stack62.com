import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { apiRequest } from "../lib/api";
import { PublicShell } from "./PublicShell";

interface Plan {
  id: string;
  tier: "free" | "starter" | "pro" | "business" | "enterprise";
  name: string;
  tagline: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  currency: string;
  perSeat: boolean;
  features: string[];
  sortOrder: number;
}

export function PricingPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<Plan[]>("/billing/plans", { token: null })
      .then((p) => {
        if (cancelled) return;
        setPlans(p.sort((a, b) => a.sortOrder - b.sortOrder));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load plans.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PublicShell>
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-10 text-center">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/5 dark:bg-white/10 text-xs font-medium text-slate-700 dark:text-slate-200 mb-5 backdrop-blur-sm border border-slate-200/60 dark:border-white/10">
          <Sparkles className="h-3.5 w-3.5" /> Simple pricing
        </span>
        <h1 className="text-5xl font-semibold tracking-tight mb-4">
          Pay for what you use.
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
          Start free. Upgrade when your team needs more AI requests, more
          systems, or more seats. Cancel anytime.
        </p>

        <div className="mt-10 inline-flex">
          <Tabs
            value={interval}
            onValueChange={(v) => setInterval(v as "monthly" | "yearly")}
          >
            <TabsList>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="yearly">
                Yearly
                <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  -17%
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-20">
        {loading && (
          <div className="text-center text-slate-500 dark:text-slate-400 py-20">
            Loading plans…
          </div>
        )}
        {error && (
          <div className="text-center text-rose-600 dark:text-rose-400 py-20">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                interval={interval}
                highlighted={plan.tier === "pro"}
                onSelect={() => {
                  if (plan.tier === "enterprise") {
                    window.location.href = "mailto:sales@stack62.com";
                    return;
                  }
                  if (plan.tier === "free") {
                    navigate("/sign-up");
                    return;
                  }
                  navigate(`/sign-up/organization?plan=${plan.tier}`);
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── What's measured ─────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-semibold tracking-tight mb-3 text-center">
          What we count
        </h2>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mb-10 max-w-xl mx-auto">
          Stack62 meters usage on the things that cost real compute. Reads,
          views, and dashboard activity are unlimited on every plan.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          <Meter
            title="AI requests"
            body="Each call to Coworker that hits a frontier model. Includes plan generation and document drafting."
          />
          <Meter
            title="Active systems"
            body="Each business system (CRM, finance, HR…) you've deployed and is running."
          />
          <Meter
            title="Storage"
            body="Files and documents you upload or generate. Counted across the org, not per user."
          />
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <h2 className="text-2xl font-semibold tracking-tight mb-8 text-center">
          Pricing FAQ
        </h2>
        <div className="space-y-5">
          <Faq
            q="What counts as an AI request?"
            a="Every call to the Coworker that reaches a frontier model (Anthropic Claude or equivalent). Tier-1 routing through smaller models is free and not metered."
          />
          <Faq
            q="What happens at the free-tier limit?"
            a="Free accounts can use one of each AI feature — generate one plan, draft one doc, deploy one system. After that, you'll see an upgrade prompt with a one-click checkout."
          />
          <Faq
            q="Can I change plans?"
            a="Anytime. Upgrades take effect immediately. Downgrades apply at the end of your current billing period."
          />
          <Faq
            q="Do you bill per seat?"
            a="Pro and Business are billed per seat per month. Free is single-user. Enterprise is custom."
          />
        </div>
      </section>
    </PublicShell>
  );
}

function PlanCard({
  plan,
  interval,
  highlighted,
  onSelect,
}: {
  plan: Plan;
  interval: "monthly" | "yearly";
  highlighted?: boolean;
  onSelect: () => void;
}) {
  const cents = interval === "yearly" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
  const monthlyEquivalent = interval === "yearly" ? Math.round(cents / 12) : cents;
  const isCustom = plan.tier === "enterprise";
  const isFree = plan.tier === "free";

  return (
    <Card
      className={`p-6 flex flex-col ${
        highlighted
          ? "border-slate-900 dark:border-white border-2 shadow-xl scale-[1.02]"
          : "border-slate-200/70 dark:border-slate-800/70"
      }`}
    >
      {highlighted && (
        <div className="text-xs font-mono uppercase tracking-wider text-slate-900 dark:text-white mb-3">
          Most popular
        </div>
      )}
      <h3 className="text-xl font-semibold tracking-tight">{plan.name}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5 leading-relaxed min-h-[3em]">
        {plan.tagline}
      </p>
      <div className="mb-6">
        {isCustom ? (
          <div className="text-3xl font-semibold">Custom</div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight">
                ${(monthlyEquivalent / 100).toFixed(0)}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                /{plan.perSeat ? "seat" : "month"}
              </span>
            </div>
            {interval === "yearly" && cents > 0 && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Billed ${(cents / 100).toFixed(0)} yearly
              </div>
            )}
            {isFree && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                No card required
              </div>
            )}
          </>
        )}
      </div>

      <Button
        variant={highlighted ? "default" : "outline"}
        className="w-full mb-6"
        onClick={onSelect}
      >
        {isCustom ? "Contact sales" : isFree ? "Start free" : "Choose plan"}
      </Button>

      <ul className="space-y-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <span className="text-slate-700 dark:text-slate-200">{f}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Meter({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-5 border-slate-200/70 dark:border-slate-800/70">
      <h3 className="font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        {body}
      </p>
    </Card>
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
