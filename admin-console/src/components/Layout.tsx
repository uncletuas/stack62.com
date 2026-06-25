import { useMemo, useState, type ReactNode, type SVGProps } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../lib/types';

/* ── Inline-SVG icon set (no icon dependency, keeps the bundle lean) ─────── */
type IconProps = SVGProps<SVGSVGElement>;
const base = (p: IconProps) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
});
const IDashboard = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
);
const IAnalytics = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" /></svg>
);
const IStaff = (p: IconProps) => (
  <svg {...base(p)}><circle cx="9" cy="8" r="3" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 8a3 3 0 0 1 0 6" /><path d="M22 20a6.5 6.5 0 0 0-4-6" /></svg>
);
const ICustomers = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 0 1 16 0" /><rect x="2" y="12" width="4" height="6" rx="1" /><rect x="18" y="12" width="4" height="6" rx="1" /><path d="M20 18a4 4 0 0 1-4 3h-2" /></svg>
);
const IBilling = (p: IconProps) => (
  <svg {...base(p)}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
);
const IAudit = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 12l2 2 4-4" /><path d="M4 4h16v16H4z" /></svg>
);
const IConfig = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" /><path d="M4 18h6" /><path d="M14 18h6" /><circle cx="12" cy="18" r="2" /></svg>
);
const IMonitoring = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>
);
const ISystem = (p: IconProps) => (
  <svg {...base(p)}><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>
);
const IDatabase = (p: IconProps) => (
  <svg {...base(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" /></svg>
);
const IEngineering = (p: IconProps) => (
  <svg {...base(p)}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>
);
const ISecurity = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3l8 3v6c0 4.5-3 7.5-8 9-5-1.5-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
const IAi = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 10h4v4h-4z" /></svg>
);
const IIntegrations = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 7V4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3M13 7V4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3" /><path d="M6 7h12v4a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></svg>
);
const IContent = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 11l16-7v16l-16-7z" /><path d="M3 11v4l4 1" /></svg>
);

type Icon = (p: IconProps) => ReactNode;
interface NavItem { to: string; label: string; icon: Icon }
interface NavGroup { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: IDashboard },
      { to: '/analytics', label: 'Analytics', icon: IAnalytics },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/staff', label: 'Staff & Roles', icon: IStaff },
      { to: '/customers', label: 'Customers & Support', icon: ICustomers },
      { to: '/content', label: 'Content & Comms', icon: IContent },
    ],
  },
  {
    label: 'Revenue',
    items: [{ to: '/billing', label: 'Billing & Plans', icon: IBilling }],
  },
  {
    label: 'Trust & Security',
    items: [
      { to: '/security', label: 'Security Center', icon: ISecurity },
      { to: '/audit', label: 'Audit Log', icon: IAudit },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/ai', label: 'AI Management', icon: IAi },
      { to: '/integrations', label: 'API & Integrations', icon: IIntegrations },
      { to: '/config', label: 'Runtime Config', icon: IConfig },
      { to: '/monitoring', label: 'Monitoring & Errors', icon: IMonitoring },
      { to: '/system', label: 'System Controls', icon: ISystem },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { to: '/database', label: 'Database', icon: IDatabase },
      { to: '/engineering', label: 'Engineering Ops', icon: IEngineering },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export function Layout({ children }: { children: ReactNode }) {
  const { staff, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const current = useMemo(() => {
    const exact = ALL_ITEMS.find((i) => i.to === location.pathname);
    if (exact) return exact;
    return (
      ALL_ITEMS.filter((i) => i.to !== '/').find((i) =>
        location.pathname.startsWith(i.to),
      ) ?? ALL_ITEMS[0]
    );
  }, [location.pathname]);

  const matches = query
    ? ALL_ITEMS.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()),
      )
    : [];

  const initials = `${staff?.firstName?.[0] ?? ''}${staff?.lastName?.[0] ?? ''}`.toUpperCase();

  return (
    <div className="flex h-screen text-[var(--ac-text)]">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--ac-border)] bg-[var(--ac-surface)]/80 backdrop-blur">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-900/40">
            S
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Stack62 Assembly</div>
            <div className="text-[11px] text-[var(--ac-faint)]">Operations Console</div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ac-faint)]">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                        isActive
                          ? 'bg-[var(--ac-accent-soft)] font-medium text-white'
                          : 'text-[var(--ac-muted)] hover:bg-white/[0.04] hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-indigo-400 transition-opacity ${
                            isActive ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <Icon
                          className={
                            isActive
                              ? 'text-indigo-300'
                              : 'text-[var(--ac-faint)] group-hover:text-[var(--ac-muted)]'
                          }
                        />
                        <span className="truncate">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--ac-border)] p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--ac-accent-soft)] text-xs font-semibold text-indigo-200">
              {initials || '—'}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm text-white">
                {staff?.firstName} {staff?.lastName}
              </div>
              <div className="truncate text-[11px] text-[var(--ac-faint)]">
                {staff ? ROLE_LABELS[staff.role] : ''}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mt-2 w-full rounded-lg border border-[var(--ac-border-strong)] px-3 py-1.5 text-xs text-[var(--ac-muted)] transition hover:bg-white/[0.04] hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--ac-border)] bg-[var(--ac-surface)]/50 px-6 backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--ac-faint)]">Assembly</span>
            <span className="text-[var(--ac-faint)]">/</span>
            <span className="font-medium text-white">{current.label}</span>
          </div>

          <div className="relative ml-auto w-72 max-w-[40vw]">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ac-faint)]"
              width={15} height={15} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches[0]) {
                  navigate(matches[0].to);
                  setQuery('');
                }
                if (e.key === 'Escape') setQuery('');
              }}
              placeholder="Jump to…"
              className="h-9 w-full rounded-lg border border-[var(--ac-border)] bg-[var(--ac-bg)]/60 pl-8 pr-3 text-sm text-white placeholder:text-[var(--ac-faint)] focus:border-indigo-500 focus:outline-none"
            />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--ac-border-strong)] bg-[var(--ac-elevated)] shadow-2xl">
                {matches.map(({ to, label, icon: Icon }) => (
                  <button
                    key={to}
                    onMouseDown={() => {
                      navigate(to);
                      setQuery('');
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--ac-muted)] hover:bg-white/[0.05] hover:text-white"
                  >
                    <Icon className="text-[var(--ac-faint)]" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden items-center gap-2 rounded-lg border border-[var(--ac-border)] px-2.5 py-1.5 sm:flex">
            <div className="grid h-6 w-6 place-items-center rounded-full bg-[var(--ac-accent-soft)] text-[11px] font-semibold text-indigo-200">
              {initials || '—'}
            </div>
            <span className="text-xs text-[var(--ac-muted)]">
              {staff ? ROLE_LABELS[staff.role] : ''}
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
