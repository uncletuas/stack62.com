import { useEffect } from "react";
import { useNavigate } from "react-router";
import { LoadingScreen } from "../components/LoadingScreen";
import { useAppContext } from "../context/app-context";
import { apiRequest } from "../lib/api";

/**
 * Single sign-on landing from loopital.com: `/sso?token=<loopital SSO token>`.
 *
 * Exchanges the short-lived loopital token for a Stack62 session via the
 * backend (`POST /auth/loopital/sso`), applies it, and sends the user into the
 * app — so one loopital account signs into Stack62, like Google/Microsoft.
 */
export function LoopitalSso() {
  const navigate = useNavigate();
  const { applyExternalSession } = useAppContext();

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      navigate("/sign-in", { replace: true });
      return;
    }
    void (async () => {
      try {
        const res = await apiRequest<{ accessToken: string }>(
          "/auth/loopital/sso",
          { method: "POST", body: { token } },
        );
        await applyExternalSession({ accessToken: res.accessToken });
        navigate("/app", { replace: true });
      } catch {
        navigate("/sign-in?error=loopital_sso_failed", { replace: true });
      }
    })();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <LoadingScreen />;
}
