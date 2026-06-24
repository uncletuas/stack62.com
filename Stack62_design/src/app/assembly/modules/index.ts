import type { ComponentType } from "react";
import type { AdminModuleKey } from "../lib/admin-api";
import { Dashboard } from "./Dashboard";
import { Executive } from "./Executive";
import { ActivityFeed } from "./ActivityFeed";
import { Users } from "./Users";
import { Organizations } from "./Organizations";
import { Billing } from "./Billing";
import { Support } from "./Support";
import { Content } from "./Content";
import { Security } from "./Security";
import { Audit } from "./Audit";
import { Ai } from "./Ai";
import { Integrations } from "./Integrations";
import { Infra } from "./Infra";
import { Config } from "./Config";
import { Observability } from "./Observability";
import { Roles } from "./Roles";

/** Maps an Assembly module key to the screen that renders it. */
export const MODULE_COMPONENTS: Record<AdminModuleKey, ComponentType> = {
  dashboard: Dashboard,
  executive: Executive,
  activity: ActivityFeed,
  users: Users,
  organizations: Organizations,
  billing: Billing,
  support: Support,
  content: Content,
  security: Security,
  audit: Audit,
  ai: Ai,
  integrations: Integrations,
  infra: Infra,
  config: Config,
  observability: Observability,
  roles: Roles,
};
