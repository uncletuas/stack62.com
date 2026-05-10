import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import {
  completeGoogleOAuth,
  completeMetaOAuth,
  completeQuickBooksOAuth,
  type IntegrationConnection,
} from "../lib/resources";

export function OAuthCallbackScreen() {
  const { provider } = useParams();
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [message, setMessage] = useState("Completing connection...");

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const realmId = params.get("realmId") ?? undefined;
      if (!code || !state) {
        setStatus("error");
        setMessage("The sign-in provider did not return a code.");
        return;
      }
      try {
        const redirectUri = `${window.location.origin}/oauth/callback/${provider}`;
        let connection: IntegrationConnection;
        if (provider === "google") {
          connection = await completeGoogleOAuth({ code, state, redirectUri });
        } else if (provider === "meta") {
          connection = await completeMetaOAuth({ code, state, redirectUri });
        } else if (provider === "quickbooks") {
          connection = await completeQuickBooksOAuth({
            code,
            state,
            realmId,
            redirectUri,
          });
        } else {
          throw new Error("Unsupported integration provider.");
        }
        setStatus("done");
        setMessage(`${connection.name} is connected.`);
        window.opener?.postMessage(
          { type: "stack62.integration.connected", provider, connectionId: connection.id },
          window.location.origin,
        );
      } catch (err) {
        setStatus("error");
        setMessage((err as Error).message);
      }
    };
    void run();
  }, [provider]);

  const Icon =
    status === "loading" ? Loader2 : status === "done" ? CheckCircle2 : XCircle;

  return (
    <div className="grid min-h-screen place-items-center bg-app p-6 text-app">
      <div className="w-full max-w-sm rounded-lg border border-app bg-slate-900/60 p-6 text-center">
        <Icon
          className={`mx-auto h-8 w-8 ${
            status === "loading"
              ? "animate-spin text-app-subtle"
              : status === "done"
                ? "text-emerald-300"
                : "text-rose-300"
          }`}
        />
        <h1 className="mt-4 text-lg font-semibold">
          {status === "done"
            ? "Connected"
            : status === "error"
              ? "Connection failed"
              : "Connecting"}
        </h1>
        <p className="mt-2 text-sm text-app-subtle">{message}</p>
        {status !== "loading" && (
          <button
            onClick={() => window.close()}
            className="mt-4 rounded bg-cyan-400 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-cyan-300"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
