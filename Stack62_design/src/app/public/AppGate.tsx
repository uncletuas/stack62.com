import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AuthScreen } from "../components/AuthScreen";
import { LoadingScreen } from "../components/LoadingScreen";
import { OnboardingScreen } from "../components/OnboardingScreen";
import { useAppContext } from "../context/app-context";
import { Workspace } from "../workspace/Workspace";

/**
 * The gate behind the `/app` route. Handles three things:
 *
 *   1. The Google OAuth callback drops a JWT in the URL fragment
 *      (`#token=…`). We pick it up here, hand it to the auth context,
 *      and clean the fragment from the address bar.
 *   2. If the user isn't authenticated, redirect to the public sign-in
 *      page (preserving the original URL as `?next=…`).
 *   3. Otherwise show the onboarding flow (if needed) or the workspace.
 */
export function AppGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isBootstrapping,
    isAuthenticated,
    needsOrganization,
    needsWorkspace,
    applyExternalSession,
  } = useAppContext();
  const [absorbingToken, setAbsorbingToken] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash && hash.startsWith("#")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("token");
      if (token) {
        setAbsorbingToken(true);
        applyExternalSession({ accessToken: token })
          .catch(() => {
            navigate("/sign-in?error=oauth_apply_failed", { replace: true });
          })
          .finally(() => {
            // Strip the fragment so the JWT doesn't sit in the URL bar.
            window.history.replaceState(
              {},
              "",
              window.location.pathname + window.location.search,
            );
            setAbsorbingToken(false);
          });
      }
    }
  }, [applyExternalSession, navigate]);

  useEffect(() => {
    if (isBootstrapping || absorbingToken) return;
    if (!isAuthenticated) {
      const next = encodeURIComponent(location.pathname + location.search);
      navigate(`/sign-in?next=${next}`, { replace: true });
    }
  }, [absorbingToken, isAuthenticated, isBootstrapping, location, navigate]);

  if (isBootstrapping || absorbingToken) return <LoadingScreen />;
  if (!isAuthenticated) {
    // Brief flicker while the redirect effect runs.
    return <AuthScreen />;
  }
  if (needsOrganization || needsWorkspace) return <OnboardingScreen />;
  return <Workspace />;
}
