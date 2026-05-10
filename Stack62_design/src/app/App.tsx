import { RouterProvider } from "react-router";
import { router } from "./routes";
import { Toaster } from "./components/ui/sonner";
import { AppProvider } from "./context/app-context";
import { ThemeProvider } from "./context/theme-context";

/**
 * The router owns gating now. Public routes (/, /sign-in, /sign-up,
 * /pricing, /invite/:token) render without auth; the /app/* tree goes
 * through AppGate which redirects to /sign-in if not authed and into
 * onboarding if the user has no org yet.
 */
export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
