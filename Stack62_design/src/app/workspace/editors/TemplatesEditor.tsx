import {
  Briefcase,
  Building2,
  Coins,
  Factory,
  GraduationCap,
  HeartPulse,
  ShoppingBag,
  Stethoscope,
  Truck,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "../workspace-context";

interface Template {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: LucideIcon;
  prompt: string;
}

const TEMPLATES: Template[] = [
  {
    key: "hr",
    name: "HR & People",
    category: "Operations",
    description: "Employees, leave, performance, onboarding.",
    icon: UsersRound,
    prompt:
      "I want to build an HR system. Track employees with personal info, role, manager, hire date, and salary. Include leave requests with approval workflow, performance reviews quarterly, and onboarding checklists for new hires.",
  },
  {
    key: "procurement",
    name: "Procurement",
    category: "Operations",
    description: "Vendors, POs, approvals, deliveries.",
    icon: Truck,
    prompt:
      "I want a procurement system. Track vendors, items, purchase orders with multi-step approval (manager → finance → CEO over thresholds), goods receipts, and invoice matching.",
  },
  {
    key: "finance",
    name: "Finance",
    category: "Operations",
    description: "Invoices, expenses, budgets.",
    icon: Coins,
    prompt:
      "Build a finance system covering invoices, expense reports with receipt uploads and reimbursement approval, monthly budgets per department, and a simple AR/AP view.",
  },
  {
    key: "crm",
    name: "CRM",
    category: "Sales",
    description: "Leads, accounts, opportunities, pipeline.",
    icon: Briefcase,
    prompt:
      "Build a CRM with leads, accounts, contacts, opportunities, and a pipeline. Include stage transitions with required fields, activity tracking, and quote generation.",
  },
  {
    key: "retail",
    name: "Retail",
    category: "Commerce",
    description: "Products, inventory, orders, returns.",
    icon: ShoppingBag,
    prompt:
      "Build a retail system: products with SKUs, multi-location inventory, customer orders with status flow, and return/refund workflow.",
  },
  {
    key: "school",
    name: "School",
    category: "Education",
    description: "Students, classes, attendance, grades.",
    icon: GraduationCap,
    prompt:
      "Build a school operations system: students, teachers, classes, schedules, attendance, grades, and parent communication.",
  },
  {
    key: "clinic",
    name: "Clinic",
    category: "Healthcare",
    description: "Patients, appointments, records, billing.",
    icon: Stethoscope,
    prompt:
      "Build a clinic system: patients, appointments with provider scheduling, encounter notes, prescriptions, and billing.",
  },
  {
    key: "wellness",
    name: "Wellness Center",
    category: "Healthcare",
    description: "Members, sessions, programs.",
    icon: HeartPulse,
    prompt:
      "Build a wellness/fitness center: members, classes, trainer schedules, attendance, packages, and renewals.",
  },
  {
    key: "manufacturing",
    name: "Manufacturing",
    category: "Operations",
    description: "Work orders, BOM, production, QC.",
    icon: Factory,
    prompt:
      "Build a manufacturing system: products with bills of materials, work orders, production scheduling, quality control checks, and finished goods inventory.",
  },
  {
    key: "real-estate",
    name: "Real Estate",
    category: "Operations",
    description: "Properties, tenants, leases, maintenance.",
    icon: Building2,
    prompt:
      "Build a real-estate management system: properties, units, tenants, leases with renewal reminders, rent collection, and maintenance tickets.",
  },
];

export function TemplatesEditor() {
  const { navigate, ensureConversation, appendMessage } = useWorkspace();

  const start = (t: Template) => {
    const tab = navigate({ kind: "system", title: t.name });
    const preset = {
      intro:
        "Tell me about the system you want to build. I'll ask follow-up questions until we have enough to draft modules, fields, workflows, and dashboards.",
      preamble:
        "You are Stack62, helping a user describe a new business system. Ask one focused clarifying question at a time about purpose, who uses it, what data it tracks, what workflows it needs, integrations, and edge cases. Keep replies under 4 sentences.",
    };
    ensureConversation(tab.id, "system", preset.intro, preset.preamble);
    appendMessage(tab.id, "user", t.prompt);
  };

  const grouped = TEMPLATES.reduce<Record<string, Template[]>>((acc, cur) => {
    (acc[cur.category] ??= []).push(cur);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-5xl p-6">
        {Object.entries(grouped).map(([category, list]) => (
          <section key={category} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-subtle">
              {category}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => start(t)}
                    className="flex items-start gap-3 rounded-xl border border-app bg-slate-900/40 p-4 text-left transition hover:border-app-strong hover:bg-app-surface"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="mt-0.5 text-xs text-app-subtle">
                        {t.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
