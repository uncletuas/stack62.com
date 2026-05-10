import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { apiRequest } from "../lib/api";
import type { GoogleAuthIntent } from "./types";

interface Props {
  intent: GoogleAuthIntent;
  redirectAfter?: string;
  inviteToken?: string;
  organizationName?: string;
  organizationRole?: string;
  organizationTeamSize?: number;
  label?: string;
  className?: string;
}

/**
 * "Continue with Google" button. Hides itself when the API reports
 * Google sign-in is not configured (env vars missing) so we don't show
 * a button that 503s.
 */
export function GoogleButton({
  intent,
  redirectAfter,
  inviteToken,
  organizationName,
  organizationRole,
  organizationTeamSize,
  label = "Continue with Google",
  className,
}: Props) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ available: boolean }>("/auth/google/available", {
      token: null,
    })
      .then((r) => {
        if (!cancelled) setAvailable(r.available);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (available === null || available === false) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        className="w-full h-11"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const { url } = await apiRequest<{ url: string }>(
              "/auth/google/url",
              {
                method: "POST",
                token: null,
                body: {
                  intent,
                  redirectAfter,
                  inviteToken,
                  organizationName,
                  organizationRole,
                  organizationTeamSize,
                },
              },
            );
            window.location.assign(url);
          } catch (err) {
            setLoading(false);
            setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
          }
        }}
      >
        <GoogleGlyph />
        {loading ? "Redirecting…" : label}
      </Button>
      {error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      className="mr-2 h-4 w-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M21.6 12.227c0-.71-.063-1.39-.181-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.997 3.018v2.5h3.232c1.892-1.741 2.983-4.305 2.983-7.341z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.964-.895 6.617-2.432l-3.232-2.5c-.896.6-2.041.954-3.385.954-2.604 0-4.81-1.759-5.595-4.122H3.064v2.59A9.997 9.997 0 0 0 12 22z"
        fill="#34A853"
      />
      <path
        d="M6.405 13.9A5.99 5.99 0 0 1 6.09 12c0-.66.114-1.3.314-1.9V7.51H3.064A9.99 9.99 0 0 0 2 12c0 1.614.386 3.14 1.064 4.49l3.341-2.59z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.977c1.468 0 2.785.504 3.823 1.495l2.867-2.867C16.96 2.991 14.696 2 12 2 8.155 2 4.84 4.214 3.064 7.51l3.341 2.59C7.19 7.736 9.396 5.977 12 5.977z"
        fill="#EA4335"
      />
    </svg>
  );
}
