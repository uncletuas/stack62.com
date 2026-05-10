import { createBrowserRouter, Navigate } from "react-router";
import { OAuthCallbackScreen } from "./components/OAuthCallbackScreen";
import { Workspace } from "./workspace/Workspace";

export const router = createBrowserRouter([
  {
    path: "/oauth/callback/:provider",
    Component: OAuthCallbackScreen,
  },
  {
    path: "/",
    Component: Workspace,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
