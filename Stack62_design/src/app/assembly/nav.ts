import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  CreditCard,
  Database,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Plug,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminModuleKey } from "./lib/admin-api";

export interface NavItem {
  key: AdminModuleKey;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Grouped navigation for the Assembly. The shell filters these by the
 *  modules the signed-in role is permitted (from `/admin/me`). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "executive", label: "Executive", icon: BarChart3 },
      { key: "activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "People",
    items: [
      { key: "users", label: "Users", icon: Users },
      { key: "organizations", label: "Organizations", icon: Building2 },
      { key: "support", label: "Support", icon: LifeBuoy },
      { key: "content", label: "Content", icon: Megaphone },
    ],
  },
  {
    label: "Revenue",
    items: [{ key: "billing", label: "Subscriptions", icon: CreditCard }],
  },
  {
    label: "Trust & Security",
    items: [
      { key: "security", label: "Security", icon: ShieldCheck },
      { key: "audit", label: "Audit Log", icon: ScrollText },
      { key: "roles", label: "Roles & Access", icon: KeyRound },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "ai", label: "AI Management", icon: Bot },
      { key: "integrations", label: "Integrations", icon: Plug },
      { key: "config", label: "Configuration", icon: FileText },
    ],
  },
  {
    label: "Engineering",
    items: [
      { key: "infra", label: "Infrastructure", icon: Database },
      { key: "observability", label: "Observability", icon: Gauge },
    ],
  },
];

export const MODULE_LABELS: Record<AdminModuleKey, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.key, i.label]),
) as Record<AdminModuleKey, string>;
