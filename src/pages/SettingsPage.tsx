import React, { useEffect, useState } from 'react';
import { Cloud, FileCheck2, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { BLUEPRINT_LIMITS, SystemAppSettings } from '../types/models';
import { sanitizeString } from '../lib/formatters';
import { PWAInstallButton } from '../components/PWAInstallButton';

const STAGES = [
  {
    stage: 'Tahap 1',
    title: 'Struktur Aplikasi, Autentikasi Nama & Sandi, Mode Offline (PWA), Dashboard, Profil Lembaga (dengan Narasi AI) & Manajemen Pengguna',
    done: true,
  },
  {
    stage: 'Tahap 2',
    title: 'Master Kategori, Master Template Proposal (10 Template), Generator Proposal (dengan Narasi AI) & Daftar Proposal',
    done: true,
  },
  {
    stage: 'Tahap 3',
    title: 'Rencana Anggaran Biaya (RAB) Otomatis, Dokumentasi & Lampiran Foto/PDF',
    done: true,
  },
  {
    stage: 'Tahap 4',
    title: 'Pratinjau A4, Ekspor Microsoft Word (.docx), Ekspor PDF, dan Arsip Proposal Permanen',
    done: true,
  },
  {
    stage: 'Tahap 5',
    title: 'Monitoring 9 Status Pengajuan, Laporan Rekapitulasi PDF/CSV, Cadangan Data JSON & Log Audit Sistem',
    done: true,
  },
];

export function SettingsPage() {
  const {
    appUser,
    appSettings,
    firebaseUser,
    firestoreConnected,
    pendingFirestoreCount,
    openCloudSyncModal,
    updateOwnProfile,
    saveAppSettings,
  } = useAuth();
  const { showToast } = useToast();

  const canManageDocSettings =
    appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [saving, setSaving] = useState(false);

  const [docForm, setDocForm] = useState<SystemAppSettings>(appSettings);
  const [savingDoc, setSavingDoc] = useState(false);

  useEffect(() => {
    if (appUser) {
      setDisplayName(appUser.displayName || '');
      setPhone(appUser.phone || '');
      setPosition(appUser.position || '');
    }
  }, [appUser]);

  useEffect(() => {
    setDocForm(appSettings);
  }, [appSettings]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;

    const cleanName = sanitizeString(displayName, BLUEPRINT_LIMITS.user.displayNameMax);
    if (!cleanName) {
      showToast('Nama lengkap wajib diisi.', 'error');
      return;
    }

    const cleanRecovery = recoveryCode.trim();
    if (cleanRecovery && cleanRecovery.length < 4) {
      showToast('Kode pemulihan akun minimal 4 karakter.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { queuedOffline } = await updateOwnProfile({
        displayName: cleanName,
        phone: sanitizeString(phone, BLUEPRINT_LIMITS.user.phoneMax),
        position: sanitizeString(position, BLUEPRINT_LIMITS.user.positionMax),
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
        recoveryCode: cleanRecovery || undefined,
      });
      setCurrentPassword('');
      setNewPassword('');
      setRecoveryCode('');
      showToast(
        queuedOffline
          ? 'Pengaturan disimpan secara lokal (offline) dan akan tersinkron otomatis.'
          : 'Pengaturan akun Anda berhasil disimpan.',
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui akun.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDocSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageDocSettings) return;
    setSavingDoc(true);
    try {
      const { queuedOffline } = await saveAppSettings({
        ...docForm,
        paperSize: 'A4',
        numberPrefix: docForm.numberPrefix.trim() || 'PROP/RQ-AR',
        defaultFiscalYear: Number(docForm.defaultFiscalYear) || new Date().getFullYear(),
        letterCity: docForm.letterCity.trim(),
        footerText: docForm.footerText.trim(),
      });
      showToast(
        queuedOffline
          ? 'Pengaturan dokumen disimpan lokal (offline) dan akan disinkronkan.'
          : 'Pengaturan dokumen & penomoran proposal berhasil disimpan.',
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal menyimpan pengaturan dokumen.',
        'error'
      );
    } finally {
      setSavingDoc(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Pengaturan Akun & Akses Offline
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Perbarui nama tampilan, jabatan, telepon, kata sandi, serta kode pemulihan akun Anda tanpa menggunakan email.
            </p>
          </div>
          <PWAInstallButton />
        </div>

        <form onSubmit={handleSaveProfile} className="mt-6 max-w-xl space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Nama Pengguna</label>
              <input
                type="text"
                disabled
                value={appUser?.username || appUser?.displayName || ''}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Peran Sistem</label>
              <input
                type="text"
                disabled
                value={appUser?.role || ''}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-[#0F3D2E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Nama Lengkap</label>
            <input
              type="text"
              required
              maxLength={BLUEPRINT_LIMITS.user.displayNameMax}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Jabatan</label>
              <input
                type="text"
                maxLength={BLUEPRINT_LIMITS.user.positionMax}
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Nomor Telepon</label>
              <input
                type="text"
                maxLength={BLUEPRINT_LIMITS.user.phoneMax}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Kata Sandi Lama (opsional)
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Isi jika ingin mengganti sandi"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Kata Sandi Baru (opsional)
              </label>
              <input
                type="password"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-slate-700">
                Kode Pemulihan Akun (Opsional · min. 4 karakter)
              </label>
              <span
                className={`text-[11px] font-medium ${
                  appUser?.hasRecoveryCode ? 'text-[#16A34A]' : 'text-amber-600'
                }`}
              >
                {appUser?.hasRecoveryCode ? 'Kode sudah diatur' : 'Belum diatur'}
              </span>
            </div>
            <input
              type="text"
              minLength={4}
              maxLength={64}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder={
                appUser?.hasRecoveryCode
                  ? 'Isi hanya jika ingin mengganti kode pemulihan'
                  : 'Tetapkan kode pemulihan untuk reset jika lupa nama/sandi'
              }
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan Akun'}
            </button>
          </div>
        </form>
      </section>

      {/* Pengaturan Dokumen & Penomoran Proposal */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-[#0F3D2E]" />
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Pengaturan Dokumen A4 & Penomoran Proposal
            </h3>
            <p className="text-xs text-slate-500">
              Mengatur format nomor surat otomatis, kota tempat penandatanganan, kop surat, dan footer dokumen Word/PDF.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveDocSettings} className="mt-5 max-w-2xl space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Awalan Nomor Proposal
              </label>
              <input
                type="text"
                disabled={!canManageDocSettings}
                value={docForm.numberPrefix}
                onChange={(e) => setDocForm((p) => ({ ...p, numberPrefix: e.target.value }))}
                placeholder="PROP/RQ-AR"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Tahun Anggaran Bawaan
              </label>
              <input
                type="number"
                min={2000}
                max={2100}
                disabled={!canManageDocSettings}
                value={docForm.defaultFiscalYear}
                onChange={(e) =>
                  setDocForm((p) => ({ ...p, defaultFiscalYear: Number(e.target.value) }))
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Kota / Nagari Tanda Tangan
              </label>
              <input
                type="text"
                disabled={!canManageDocSettings}
                value={docForm.letterCity}
                onChange={(e) => setDocForm((p) => ({ ...p, letterCity: e.target.value }))}
                placeholder="Contoh: Agam / Lasi"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Catatan Kaki (Footer) Dokumen PDF
            </label>
            <input
              type="text"
              disabled={!canManageDocSettings}
              value={docForm.footerText}
              onChange={(e) => setDocForm((p) => ({ ...p, footerText: e.target.value }))}
              placeholder="Contoh: Dokumen Resmi Pengajuan Proposal"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              disabled={!canManageDocSettings}
              checked={docForm.includeLogoInLetterhead}
              onChange={(e) =>
                setDocForm((p) => ({ ...p, includeLogoInLetterhead: e.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E] focus:ring-[#0F3D2E]"
            />
            Sertakan Logo Lembaga pada Kop Surat saat Pratinjau dan Ekspor Word/PDF
          </label>

          {canManageDocSettings && (
            <div className="pt-2">
              <button
                type="submit"
                disabled={savingDoc}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {savingDoc ? 'Menyimpan...' : 'Simpan Pengaturan Dokumen'}
              </button>
            </div>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0F3D2E]/10 text-[#0F3D2E]">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Sinkronisasi Latar Belakang & Cloud Firestore
              </h3>
              <p className="mt-1 text-xs text-slate-600">
                {firestoreConnected
                  ? `Terhubung ke Firestore (${firebaseUser?.email}). Perubahan lokal saat offline otomatis disinkronkan ketika internet kembali.`
                  : 'Hubungkan akun Google Anda untuk mengaktifkan cadangan dan sinkronisasi otomatis proposal ke Cloud Firestore.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCloudSyncModal}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {pendingFirestoreCount > 0
              ? `Kelola Antrean (${pendingFirestoreCount})`
              : firestoreConnected
              ? 'Kelola Sinkronisasi Cloud'
              : 'Hubungkan & Sinkronkan'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-[#111C18]">
          Status Kelengkapan Modul Sistem
        </h3>
        <div className="mt-4 divide-y divide-slate-100">
          {STAGES.map((item) => (
            <div
              key={item.stage}
              className="flex flex-col justify-between gap-2 py-3.5 sm:flex-row sm:items-center"
            >
              <div>
                <p className="text-xs font-semibold text-[#0F3D2E]">{item.stage}</p>
                <p className="mt-0.5 text-sm text-[#111C18]">{item.title}</p>
              </div>
              <span className="text-xs font-medium text-[#16A34A] whitespace-nowrap">
                Aktif & Terverifikasi
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
