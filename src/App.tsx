import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { InstitutionProfilePage } from './pages/InstitutionProfilePage';
import { UsersManagementPage } from './pages/UsersManagementPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CreateProposalPage } from './pages/CreateProposalPage';
import { ProposalsListPage } from './pages/ProposalsListPage';
import { RabPage } from './pages/RabPage';
import { DocumentationPage } from './pages/DocumentationPage';
import { ArchivePage } from './pages/ArchivePage';
import { MonitoringPage } from './pages/MonitoringPage';
import { ReportsPage } from './pages/ReportsPage';

function AppRoutes() {
  const { appUser, authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAF9]">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#0F3D2E] border-t-transparent" />
          <p className="mt-3 text-sm font-medium text-slate-600">
            Menghubungkan ke sistem...
          </p>
        </div>
      </div>
    );
  }

  if (!appUser || appUser.status !== 'active') {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profil-lembaga" element={<InstitutionProfilePage />} />
        <Route path="/template-proposal" element={<TemplatesPage />} />
        <Route path="/kategori-proposal" element={<CategoriesPage />} />
        <Route path="/buat-proposal" element={<CreateProposalPage />} />
        <Route path="/daftar-proposal" element={<ProposalsListPage />} />
        <Route path="/rab" element={<RabPage />} />
        <Route path="/dokumentasi" element={<DocumentationPage />} />
        <Route path="/arsip" element={<ArchivePage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/laporan" element={<ReportsPage />} />
        <Route path="/pengguna" element={<UsersManagementPage />} />
        <Route path="/pengaturan" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
