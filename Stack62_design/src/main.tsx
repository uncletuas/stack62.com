import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./app/App.tsx";
import "./styles/index.css";

// Sentry must initialise before React renders so errors thrown during
// render are captured. Set VITE_SENTRY_DSN at build time to enable.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || "dev",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Don't record everything — sample low and only on errors.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: Number(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1",
    ),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    beforeSend(event) {
      // Strip auth tokens from URL fragments.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /([?&#]token=)[^&]+/g,
          "$1[redacted]",
        );
      }
      return event;
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
