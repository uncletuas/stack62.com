import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { StaffPage } from './pages/StaffPage';
import { AuditPage } from './pages/AuditPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CustomersPage } from './pages/CustomersPage';
import { ConfigPage } from './pages/ConfigPage';
import { BillingPage } from './pages/BillingPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { EngineeringPage } from './pages/EngineeringPage';
import { SystemPage } from './pages/SystemPage';
import { DatabasePage } from './pages/DatabasePage';
import { AiPage } from './pages/AiPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ContentPage } from './pages/ContentPage';
import { SecurityPage } from './pages/SecurityPage';

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function Protected() {
  const { staff, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }
  if (!staff) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <Protected />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/analytics', element: <AnalyticsPage /> },
          { path: '/staff', element: <StaffPage /> },
          { path: '/audit', element: <AuditPage /> },
          { path: '/security', element: <SecurityPage /> },
          { path: '/ai', element: <AiPage /> },
          { path: '/integrations', element: <IntegrationsPage /> },
          { path: '/content', element: <ContentPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/config', element: <ConfigPage /> },
          { path: '/billing', element: <BillingPage /> },
          { path: '/monitoring', element: <MonitoringPage /> },
          { path: '/engineering', element: <EngineeringPage /> },
          { path: '/system', element: <SystemPage /> },
          { path: '/database', element: <DatabasePage /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
