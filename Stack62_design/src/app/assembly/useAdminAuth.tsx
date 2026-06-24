import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAdminMe, type AdminMe, type AdminModuleKey } from "./lib/admin-api";

interface AdminAuthValue {
  me: AdminMe | null;
  loading: boolean;
  /** Set when /admin/me failed — `forbidden` means signed-in but no role. */
  error: "forbidden" | "unauthorized" | "network" | null;
  can: (module: AdminModuleKey) => boolean;
  reload: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminAuthValue["error"]>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    getAdminMe()
      .then((data) => {
        if (!live) return;
        setMe(data);
        setLoading(false);
      })
      .catch((err: { status?: number }) => {
        if (!live) return;
        setMe(null);
        setError(
          err?.status === 401
            ? "unauthorized"
            : err?.status === 403
              ? "forbidden"
              : err?.status === 0
                ? "network"
                : "forbidden",
        );
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const value = useMemo<AdminAuthValue>(() => {
    const modules = new Set(me?.modules ?? []);
    return {
      me,
      loading,
      error,
      can: (module) =>
        me?.platformRole === "super_admin" || modules.has(module),
      reload: () => setNonce((n) => n + 1),
    };
  }, [me, loading, error]);

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx)
    throw new Error("useAdminAuth must be used inside AdminAuthProvider.");
  return ctx;
}
