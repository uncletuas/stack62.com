import { useEffect, useState } from "react";
import { Loader2, Mail, Trash2, Users } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAppContext } from "../../context/app-context";
import {
  fetchMemberships,
  fetchPendingInvites,
  fetchUsers,
  inviteMember,
  removeMember,
  updateMember,
  type Membership,
  type OrgInvite,
  type UserSummary,
} from "../../lib/resources";
import { useWorkspace } from "../workspace-context";

const ROLES = ["owner", "admin", "manager", "member", "viewer"];

export function TeamsEditor() {
  const { currentOrganization } = useAppContext();
  const { appendRunLog } = useWorkspace();
  const [members, setMembers] = useState<Membership[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!currentOrganization) return;
    const [m, u, inv] = await Promise.all([
      fetchMemberships({ organizationId: currentOrganization.id }).catch(() => []),
      fetchUsers().catch(() => []),
      fetchPendingInvites(currentOrganization.id).catch(() => []),
    ]);
    setMembers(m);
    setUsers(u);
    setInvites(inv);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganization?.id]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  const invite = async () => {
    if (!currentOrganization || !email) return;
    setBusy(true);
    try {
      await inviteMember({
        organizationId: currentOrganization.id,
        email,
        role,
      });
      appendRunLog({ level: "ok", text: `Invited ${email}`, source: "teams" });
      setEmail("");
      await reload();
    } catch (err) {
      appendRunLog({
        level: "error",
        text: `Invite failed: ${(err as Error).message}`,
        source: "teams",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-app text-app">
      <div className="mx-auto max-w-4xl p-6">
        <header className="flex items-center gap-3 border-b border-app pb-3">
          <Users className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-semibold">Team</h1>
          <span className="text-xs text-app-faint">{members.length} members</span>
        </header>

        <section className="mt-5 rounded-xl border border-app bg-app-hover p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-app-subtle">
            Invite member
          </h2>
          <div className="mt-2 flex gap-2">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              type="email"
              className="border-app bg-app"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded border border-app bg-app px-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button onClick={() => void invite()} disabled={busy || !email} className="gap-1">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Invite
            </Button>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-subtle">
            Members
          </h2>
          <div className="overflow-hidden rounded-xl border border-app">
            <table className="w-full text-xs">
              <thead className="bg-app-surface text-[10px] uppercase tracking-wider text-app-faint">
                <tr>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const u = userMap.get(m.userId);
                  return (
                    <tr key={m.id} className="border-t border-app">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-app">
                          {u ? `${u.firstName} ${u.lastName}` : m.userId}
                        </p>
                        <p className="text-[11px] text-app-faint">{u?.email}</p>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={m.role}
                          onChange={async (e) => {
                            await updateMember(m.id, { role: e.target.value });
                            void reload();
                          }}
                          className="rounded border border-app bg-app-surface px-2 py-1"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-app-subtle">{m.status}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={async () => {
                            await removeMember(m.id);
                            void reload();
                          }}
                          className="text-app-faint hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-app-faint">
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {invites.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-subtle">
              Pending invites
            </h2>
            <div className="space-y-2">
              {invites.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded border border-app bg-app-hover p-3 text-sm"
                >
                  <Mail className="h-4 w-4 text-app-faint" />
                  <span className="flex-1">{i.email}</span>
                  <span className="text-xs text-app-faint">{i.role}</span>
                  <span className="text-xs text-amber-300">{i.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
