import { createBrowserRouter, Navigate } from "react-router";
import { OAuthCallbackScreen } from "./components/OAuthCallbackScreen";
import { AssemblyGate } from "./assembly/AssemblyGate";
import { AppGate } from "./public/AppGate";
import { InviteAccept } from "./public/InviteAccept";
import { LandingPage } from "./public/LandingPage";
import { PricingPage } from "./public/PricingPage";
import { SignIn } from "./public/SignIn";
import {
  SignUpChooser,
  SignUpGuard,
  SignUpIndividual,
  SignUpOrganization,
} from "./public/SignUp";
import { SheetEditor } from "./workspace/editors/SheetEditor";

function TestSheetPage() {
  return <SheetEditor text="" onChange={() => {}} title="Test Spreadsheet" />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: LandingPage,
  },
  {
    path: "/test-sheet",
    Component: TestSheetPage,
  },
  {
    path: "/pricing",
    Component: PricingPage,
  },
  {
    path: "/sign-in",
    element: (
      <SignUpGuard>
        <SignIn />
      </SignUpGuard>
    ),
  },
  {
    path: "/sign-up",
    element: (
      <SignUpGuard>
        <SignUpChooser />
      </SignUpGuard>
    ),
  },
  {
    path: "/sign-up/individual",
    element: (
      <SignUpGuard>
        <SignUpIndividual />
      </SignUpGuard>
    ),
  },
  {
    path: "/sign-up/organization",
    element: (
      <SignUpGuard>
        <SignUpOrganization />
      </SignUpGuard>
    ),
  },
  {
    path: "/invite/:token",
    Component: InviteAccept,
  },
  {
    path: "/oauth/callback/:provider",
    Component: OAuthCallbackScreen,
  },
  {
    path: "/app/*",
    Component: AppGate,
  },
  {
    path: "/assembly/*",
    Component: AssemblyGate,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
