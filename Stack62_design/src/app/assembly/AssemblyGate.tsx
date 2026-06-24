import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { ShieldAlert } from "lucide-react";
import { LoadingScreen } from "../components/LoadingScreen";
import { useAppContext } from "../context/app-context";
import { AdminAuthProvider, useAdminAuth } from "./useAdminAuth";
import { AssemblyShell } from "./AssemblyShell";

/**
 * The gate behind `/assembly/*`. Authentication reuses the customer app
 * context; authorization is the platform role from `GET /v1/admin/me`.
 * Mirrors the structure of `public/AppGate.tsx`.
 */
export function AssemblyGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isBootstrapping, isAuthenticated } = useAppContext();

  useEffect(() => {
    if (isBootstrapping) return;
    if (!isAuthenticated) {
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/sign-in?next=${next}`, { replace: true });
    }
  }, [isAuthenticated, isBootstrapping, location, navigate]);

  if (isBootstrapping) return <LoadingScreen />;
  if (!isAuthenticated) return <LoadingScreen />;

  return (
    <AdminAuthProvider>
      <AssemblyInner />
    </AdminAuthProvider>
  );
}

function AssemblyInner() {
  const { loading, error, me } = useAdminAuth();
  const navigate = useNavigate();

  if (loading) return <LoadingScreen />;
  if (error === "unauthorized") {
    navigate("/sign-in?next=/assembly", { replace: true });
    return <LoadingScreen />;
  }
  if (error || !me) return <NotAuthorized />;
  return <AssemblyShell />;
}

function NotAuthorized() {
  const navigate = useNavigate();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-app px-6 text-center text-app">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-500">
        <ShieldAlert className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Administrative access required</h1>
        <p className="mt-1 max-w-sm text-sm text-app-muted">
          Your account doesn't have a Stack62 platform role. If you believe this
          is a mistake, contact a super administrator.
        </p>
      </div>
      <button
        onClick={() => navigate("/app")}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        Back to Stack62
      </button>
    </div>
  );
}
