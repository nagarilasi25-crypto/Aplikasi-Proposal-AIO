import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { BLUEPRINT_LIMITS } from '../types/models';
import { sanitizeString } from '../lib/formatters';
import { PWAInstallButton } from '../components/PWAInstallButton';

const STAGES = [
  {
    stage: 'Tahap 1',
    title: 'Struktur Aplikasi, Autentikasi Nama & Sandi, Mode Offline (PWA), Dashboard, Profil Lembaga & Manajemen Pengguna',
    done: true,
  },
  {
    stage: 'Tahap 2',
    title: 'Master Kategori, Master Template Proposal, Generator & Editor Proposal',
    done: false,
  },
  {
    stage: 'Tahap 3',
    title: 'Rencana Anggaran Biaya (RAB) Otomatis, Dokumentasi & Lampiran',
    done: false,
  },
  {
    stage: 'Tahap 4',
    title: 'Ekspor Word (.docx), Ekspor PDF, dan Arsip Proposal',
    done: false,
  },
  {
    stage: 'Tahap 5',
    title: 'Monitoring Pengajuan, Laporan, serta Audit & Pengujian Akhir',
    done: false,
  },
];

export function SettingsPage() {
  const { appUser, updateOwnProfile } = useAuth();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (appUser) {
      setDisplayName(appUser.displayName || '');
      setPhone(appUser.phone || '');
      setPosition(appUser.position || '');
    }
  }, [appUser]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;

    const cleanName = sanitizeString(displayName, BLUEPRINT_LIMITS.user.displayNameMax);
    if (!cleanName) {
      showToast('Nama lengkap wajib diisi.', 'error');
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
      });
      setCurrentPassword('');
      setNewPassword('');
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

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Pengaturan Akun & Akses Offline
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Perbarui nama tampilan, jabatan, telepon, serta kata sandi akun Anda tanpa menggunakan email.
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

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-[#111C18]">
          Tahapan Pembangunan Sistem
        </h3>
        <div className="mt-4 divide-y divide-slate-100">
          {STAGES.map((item) => (
            <div key={item.stage} className="flex flex-col justify-between gap-2 py-3.5 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-semibold text-[#0F3D2E]">{item.stage}</p>
                <p className="mt-0.5 text-sm text-[#111C18]">{item.title}</p>
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  item.done ? 'text-[#16A34A]' : 'text-slate-500'
                }`}
              >
                {item.done ? 'Aktif & Terverifikasi' : 'Dijadwalkan'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
