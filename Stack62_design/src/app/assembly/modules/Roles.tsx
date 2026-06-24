import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { listStaff, setPlatformRole, type AdminUser } from "../lib/admin-api";
import {
  AsyncBoundary,
  DataTable,
  ModuleHeader,
  Panel,
  StatusBadge,
} from "../components";

const ROLES = [
  "super_admin",
  "finance_manager",
  "support_manager",
  "engineer",
  "security_officer",
  "operations_manager",
  "executive",
];

export function Roles() {
  const [staff, setStaff] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listStaff()
      .then((d) => {
        setStaff(d);
        setLoading(false);
      })
      .catch((e: { message?: string }) => {
        setError(e?.message ?? "Failed to load staff.");
        setLoading(false);
      });
  }, []);
  useEffect(() => load(), [load]);

  const change = async (id: string, role: string | null) => {
    await setPlatformRole(id, role);
    load();
  };

  return (
    <div>
      <ModuleHeader
        icon={KeyRound}
        title="Roles & Access"
        description="Assign platform roles to Loopital staff. Every change is audited."
      />
      <AsyncBoundary loading={loading} error={error} onRetry={load}>
        <div className="p-6">
          <Panel title="Loopital staff">
            <DataTable
              rows={staff}
              rowKey={(u) => u.id}
              empty="No staff with platform roles yet."
              columns={[
                {
                  key: "name",
                  header: "User",
                  render: (u) => (
                    <div>
                      <div className="font-medium">
                        {u.firstName} {u.lastName}
                      </div>
                      <div className="text-xs text-app-faint">{u.email}</div>
                    </div>
                  ),
                },
                {
                  key: "role",
                  header: "Current role",
                  render: (u) =>
                    u.platformRole ? (
                      <StatusBadge value={u.platformRole} />
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "set",
                  header: "Change role",
                  className: "text-right",
                  render: (u) => (
                    <select
                      value={u.platformRole ?? ""}
                      onChange={(e) =>
                        change(u.id, e.target.value || null)
                      }
                      className="h-8 rounded-md border border-app bg-app px-2 text-xs"
                    >
                      <option value="">None (revoke)</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ),
                },
              ]}
            />
          </Panel>
          <p className="mt-3 text-xs text-app-faint">
            To grant a brand-new staff member access, set their role from User
            Management or have a super admin run the grant script.
          </p>
        </div>
      </AsyncBoundary>
    </div>
  );
}
