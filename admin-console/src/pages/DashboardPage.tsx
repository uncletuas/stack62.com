import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../lib/types';

export function DashboardPage() {
  const { staff } = useAuth();
  if (!staff) return null;

  return (
    <div>
      <h1 className="text-xl font-semibold text-white">
        Welcome, {staff.firstName}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        You are signed in as{' '}
        <span className="text-slate-200">{ROLE_LABELS[staff.role]}</span>.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          title="Staff & Roles"
          body="Create staff accounts, assign positions, enforce 2FA, and review the role → capability matrix."
          available
        />
        <Card
          title="Audit Log"
          body="Every staff action and customer-facing event, searchable across all organizations, exportable to CSV."
          available
        />
        <Card
          title="Customers & Support"
          body="Search organizations and users, view subscriptions and usage, handle complaints, time-boxed impersonation."
          available
        />
        <Card
          title="Runtime Config"
          body="Edit API keys, feature flags and other variables without a redeploy via an encrypted settings overlay."
          available
        />
        <Card
          title="Billing & Plans"
          body="Adjust subscription amounts and plan limits, review subscriptions, override an org's plan."
          available
        />
        <Card
          title="Engineering Ops"
          body="Trigger migrations and key rotation behind approval gates — request, second-approver, execute."
          available
        />
      </div>

      <p className="mt-6 text-xs text-slate-600">
        All console areas are live: staff auth & RBAC, audit, customers & support,
        runtime config, billing, monitoring, and approval-gated engineering ops.
      </p>
    </div>
  );
}

function Card({
  title,
  body,
  available,
}: {
  title: string;
  body: string;
  available?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            available
              ? 'bg-emerald-900 text-emerald-300'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          {available ? 'Live' : 'Soon'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
