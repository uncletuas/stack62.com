import { RouterProvider } from "react-router";
import { router } from "./routes";
import { Toaster } from "./components/ui/sonner";
import { AppProvider, useAppContext } from "./context/app-context";
import { ThemeProvider } from "./context/theme-context";
import { AuthScreen } from "./components/AuthScreen";
import { LoadingScreen } from "./components/LoadingScreen";
import { OnboardingScreen } from "./components/OnboardingScreen";

function AppContent() {
  const {
    isBootstrapping,
    isAuthenticated,
    needsOrganization,
    needsWorkspace,
  } = useAppContext();

  if (isBootstrapping) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  if (needsOrganization || needsWorkspace) {
    return <OnboardingScreen />;
  }

  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppContent />
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
