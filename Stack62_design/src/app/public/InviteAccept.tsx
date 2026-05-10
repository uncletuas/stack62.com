import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useAppContext } from "../context/app-context";
import { apiRequest } from "../lib/api";
import { PublicShell } from "./PublicShell";

interface InvitePreview {
  email: string;
  role: string;
  organizationId: string;
  workspaceId: string | null;
  expiresAt: string;
  invitedBy: { firstName: string; lastName: string } | null;
}

interface OrgInfo {
  id: string;
  name: string;
}

/**
 * `/invite/:token` — public preview of an invite. The token is opaque
 * (32 random bytes), so showing the org name to whoever holds the URL
 * is fine. Three branches:
 *
 *   1. Logged in + email matches → one-click accept.
 *   2. Logged in + email doesn't match → "you're signed in as X, but the
 *      invite was sent to Y" — sign out + sign in as Y.
 *   3. Not logged in → "Join {Org} as {role}" — sign-in or create-account
 *      buttons that pre-fill the email + carry the token forward.
 */
export function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, token: jwt, logout, refreshContext } =
    useAppContext();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiRequest<InvitePreview>(`/memberships/invites/lookup/${token}`, {
      token: null,
    })
      .then(async (preview) => {
        if (cancelled) return;
        setInvite(preview);
        // Org name is nice-to-have. If the lookup fails (e.g. user is
        // logged in to a different org and access-control hides it), we
        // just show "an organization" instead of breaking the page.
        try {
          if (jwt) {
            const orgRow = await apiRequest<OrgInfo>(
              `/organizations/${preview.organizationId}`,
              { token: jwt },
            );
            if (!cancelled) setOrg(orgRow);
          }
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "This invite is invalid or has expired.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, token]);

  const accept = async () => {
    if (!token || !jwt) return;
    setAccepting(true);
    try {
      await apiRequest("/memberships/accept-invite", {
        method: "POST",
        token: jwt,
        body: { token },
      });
      await refreshContext();
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite.");
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <PublicShell>
        <div className="max-w-md mx-auto px-6 py-24 text-center text-slate-500 dark:text-slate-400">
          Looking up invite…
        </div>
      </PublicShell>
    );
  }
  if (error || !invite) {
    return (
      <PublicShell>
        <div className="max-w-md mx-auto px-6 py-24">
          <Card className="p-8 border-rose-200/60 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 text-center">
            <h1 className="text-xl font-semibold mb-2">Invite unavailable</h1>
            <p className="text-sm text-rose-700 dark:text-rose-300 mb-5">
              {error || "This invite link is no longer valid."}
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>
              Back to Stack62
            </Button>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const orgName = org?.name || "an organization";
  const inviter = invite.invitedBy
    ? `${invite.invitedBy.firstName} ${invite.invitedBy.lastName}`
    : "Someone";
  const emailMatches =
    isAuthenticated && user?.email?.toLowerCase() === invite.email.toLowerCase();

  return (
    <PublicShell>
      <div className="max-w-md mx-auto px-6 py-16">
        <Card className="p-8 border-slate-200/70 dark:border-slate-800/70">
          <div className="h-12 w-12 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center mb-5">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">
            You're invited to {orgName}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
            {inviter} invited <strong>{invite.email}</strong> to join as{" "}
            <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
              {invite.role}
            </span>
            .
          </p>

          {!isAuthenticated && (
            <div className="space-y-3">
              <Button
                className="w-full h-11"
                onClick={() =>
                  navigate(
                    `/sign-up?inviteToken=${encodeURIComponent(token || "")}`,
                  )
                }
              >
                Create account & join <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() =>
                  navigate(
                    `/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`,
                  )
                }
              >
                Sign in to existing account
              </Button>
              <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-2">
                Already have a Stack62 account? Sign in with{" "}
                <strong>{invite.email}</strong> to accept.
              </p>
            </div>
          )}

          {isAuthenticated && emailMatches && (
            <Button
              className="w-full h-11"
              disabled={accepting}
              onClick={accept}
            >
              {accepting
                ? "Joining…"
                : `Accept invite & join ${orgName}`}
            </Button>
          )}

          {isAuthenticated && !emailMatches && (
            <div className="space-y-3">
              <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/60 rounded-md p-3">
                You're signed in as <strong>{user?.email}</strong>, but this
                invite was sent to <strong>{invite.email}</strong>.
              </p>
              <Button
                className="w-full h-11"
                onClick={() => {
                  logout();
                  navigate(
                    `/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`,
                  );
                }}
              >
                Sign out and switch accounts
              </Button>
            </div>
          )}
        </Card>

        <div className="mt-6 flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
          <p>
            Stack62 isolates each organization. You'll only see{" "}
            {orgName}'s systems and data — your existing Stack62 account stays
            separate.
          </p>
        </div>

        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6">
          Not what you expected? <Link to="/" className="underline">Go to Stack62</Link>
        </p>
      </div>
    </PublicShell>
  );
}
