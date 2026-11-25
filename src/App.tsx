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
import { UpcomingModulePage } from './pages/UpcomingModulePage';

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
        <Route path="/pengguna" element={<UsersManagementPage />} />
        <Route path="/pengaturan" element={<SettingsPage />} />

        <Route
          path="/template-proposal"
          element={
            <UpcomingModulePage
              title="Master Template Proposal"
              stage="Tahap 2"
              description="Pengelolaan 10 template standar proposal Rumah Quran Ar Raudhah dengan struktur bab yang dapat ditambah, diurutkan, diaktifkan, diduplikasi, dan disesuaikan."
              plannedFeatures={[
                '10 template awal (Pembangunan, Renovasi, Pengadaan Sarana, Pendidikan, Tahfidz, Operasional, Beasiswa, Kegiatan, Pengembangan Lembaga, Umum)',
                'Pengaturan urutan dan aktivasi bab dokumen secara dinamis',
                'Duplikasi dan penyuntingan template sesuai hak akses',
              ]}
            />
          }
        />
        <Route
          path="/kategori-proposal"
          element={
            <UpcomingModulePage
              title="Kategori Proposal"
              stage="Tahap 2"
              description="Pengelolaan daftar kategori proposal resmi untuk pengelompokan statistik dashboard, pengarsipan, dan pelaporan."
              plannedFeatures={[
                'Tambah, ubah, dan nonaktifkan kategori proposal',
                'Kode klasifikasi kategori untuk penomoran dokumen',
                'Integrasi langsung dengan grafik Dashboard dan formulir proposal',
              ]}
            />
          }
        />
        <Route
          path="/buat-proposal"
          element={
            <UpcomingModulePage
              title="Buat Proposal"
              stage="Tahap 2"
              description="Generator proposal bertahap yang terhubung langsung dengan Profil Lembaga, Master Template, dan Rencana Anggaran Biaya."
              plannedFeatures={[
                'Formulir bertahap dengan editor konten per bab proposal',
                'Integrasi otomatis data Profil Rumah Quran Ar Raudhah tanpa data fiktif',
                'Pratinjau dokumen sebelum proses cetak dan ekspor',
              ]}
            />
          }
        />
        <Route
          path="/daftar-proposal"
          element={
            <UpcomingModulePage
              title="Daftar Proposal"
              stage="Tahap 2"
              description="Daftar seluruh proposal tersimpan di Firestore lengkap dengan penyuntingan, status, dan tautan ke RAB serta lampiran."
              plannedFeatures={[
                'Tabel data seluruh proposal dengan pencarian dan filter cepat',
                'Akses langsung ke editor konten proposal dan pratinjau',
                'Sinkronisasi otomatis ke Dashboard dan Arsip Proposal',
              ]}
            />
          }
        />
        <Route
          path="/rab"
          element={
            <UpcomingModulePage
              title="Rencana Anggaran Biaya"
              stage="Tahap 3"
              description="Penyusunan RAB otomatis terintegrasi dengan proposal dengan perhitungan volume × harga satuan, kelompok pekerjaan, dan format rupiah Indonesia."
              plannedFeatures={[
                'Tabel item RAB (Nomor, Uraian, Volume, Satuan, Harga Satuan, Jumlah)',
                'Pengelompokan pekerjaan, subtotal kelompok, dan total anggaran otomatis',
                'Penyimpanan ke koleksi proposalBudgets dan sinkronisasi total proposal',
              ]}
            />
          }
        />
        <Route
          path="/dokumentasi"
          element={
            <UpcomingModulePage
              title="Dokumentasi dan Lampiran"
              stage="Tahap 3"
              description="Pengelolaan unggahan foto lokasi, bangunan, kegiatan, legalitas, dan berkas pendukung melalui Firebase Storage yang terhubung ke proposal."
              plannedFeatures={[
                'Unggahan terklasifikasi (lokasi, bangunan, kegiatan, sarana, legalitas, desain)',
                'Penghubungan langsung berkas dengan proposal tertentu',
                'Penyertaan lampiran foto pada hasil cetak Word dan PDF',
              ]}
            />
          }
        />
        <Route
          path="/arsip"
          element={
            <UpcomingModulePage
              title="Arsip Proposal & Ekspor Dokumen"
              stage="Tahap 4"
              description="Pengarsipan permanen, pencetakan, dan ekspor dokumen proposal resmi dalam format Microsoft Word (.docx) yang dapat diedit serta PDF siap cetak A4."
              plannedFeatures={[
                'Ekspor Word (.docx) dan PDF ukuran A4 dengan margin, font, logo, tanda tangan, RAB, dan lampiran foto',
                'Pencarian arsip berdasarkan judul, nomor, tahun, kategori, dan instansi',
                'Duplikasi proposal dari arsip untuk pengajuan baru',
              ]}
            />
          }
        />
        <Route
          path="/monitoring"
          element={
            <UpcomingModulePage
              title="Monitoring Pengajuan"
              stage="Tahap 5"
              description="Pemantauan seluruh siklus status pengajuan proposal dari Draft hingga Bantuan Diterima dan Selesai beserta riwayat perubahannya."
              plannedFeatures={[
                'Alur 9 status pengajuan dan pencatatan nominal disetujui serta diterima',
                'Persetujuan oleh Pimpinan dan catatan tindak lanjut',
                'Riwayat perubahan status tersimpan pada proposalStatusHistory',
              ]}
            />
          }
        />
        <Route
          path="/laporan"
          element={
            <UpcomingModulePage
              title="Laporan"
              stage="Tahap 5"
              description="Rekapitulasi laporan pengajuan proposal, realisasi bantuan, dan log audit sistem untuk kebutuhan evaluasi pimpinan."
              plannedFeatures={[
                'Rekapitulasi nilai pengajuan dan realisasi bantuan per tahun & kategori',
                'Ekspor laporan dan pencadangan arsip berkala',
                'Peninjauan log audit keamanan sistem',
              ]}
            />
          }
        />

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
