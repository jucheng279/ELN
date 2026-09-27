import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const SignUpPage = lazy(() => import('@/pages/auth/SignUpPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const InvitationAcceptPage = lazy(() => import('@/pages/auth/InvitationAcceptPage'));
const WorkspaceSelectPage = lazy(() => import('@/pages/workspace/WorkspaceSelectPage'));
const AppLayout = lazy(() => import('@/components/layout/AppLayout'));
const ExperimentListPage = lazy(() => import('@/pages/experiments/ExperimentListPage'));
const ExperimentPage = lazy(() => import('@/pages/experiments/ExperimentPage'));
const MyExperimentsPage = lazy(() => import('@/pages/experiments/MyExperimentsPage'));
const FavoritesPage = lazy(() => import('@/pages/experiments/FavoritesPage'));
const RecentPage = lazy(() => import('@/pages/experiments/RecentPage'));
const ArchivedPage = lazy(() => import('@/pages/experiments/ArchivedPage'));
const NotebookPage = lazy(() => import('@/pages/notebooks/NotebookPage'));
const CreateNotebookPage = lazy(() => import('@/pages/notebooks/CreateNotebookPage'));
const TemplatesPage = lazy(() => import('@/pages/templates/TemplatesPage'));
const TemplateEditorPage = lazy(() => import('@/pages/templates/TemplateEditorPage'));
const ProtocolsPage = lazy(() => import('@/pages/protocols/ProtocolsPage'));
const ProtocolEditorPage = lazy(() => import('@/pages/protocols/ProtocolEditorPage'));
const SearchPage = lazy(() => import('@/pages/search/SearchPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) return <Spinner />;
  if (user) return <Navigate to="/workspaces" replace />;
  return <>{children}</>;
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    const cleanup = initialize() as unknown as (() => void) | void;
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [initialize]);

  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<GuestGuard><LoginPage /></GuestGuard>} />
          <Route path="/signup" element={<GuestGuard><SignUpPage /></GuestGuard>} />
          <Route path="/forgot-password" element={<GuestGuard><ForgotPasswordPage /></GuestGuard>} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/invite" element={<InvitationAcceptPage />} />

          <Route path="/workspaces" element={<AuthGuard><WorkspaceSelectPage /></AuthGuard>} />

          <Route path="/app" element={<AuthGuard><AppLayout /></AuthGuard>}>
            <Route index element={<ExperimentListPage />} />
            <Route path="experiments" element={<ExperimentListPage />} />
            <Route path="experiments/:id" element={<ExperimentPage />} />
            <Route path="my-experiments" element={<MyExperimentsPage />} />
            <Route path="favorites" element={<FavoritesPage />} />
            <Route path="recent" element={<RecentPage />} />
            <Route path="archived" element={<ArchivedPage />} />
            <Route path="notebooks/new" element={<CreateNotebookPage />} />
            <Route path="notebooks/:id" element={<NotebookPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="templates/:id" element={<TemplateEditorPage />} />
            <Route path="protocols" element={<ProtocolsPage />} />
            <Route path="protocols/:id" element={<ProtocolEditorPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
