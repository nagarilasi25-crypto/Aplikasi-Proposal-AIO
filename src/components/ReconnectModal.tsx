import React, { useState } from 'react';
import { Lock, RefreshCw, Trash2, Wifi, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';

export function ReconnectModal() {
  const {
    appUser,
    reconnectModalOpen,
    closeReconnectModal,
    pendingSyncCount,
    lastSyncError,
    reconnectServerSession,
    clearPendingQueue,
  } = useAuth();
  const { showToast } = useToast();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!reconnectModalOpen || !appUser) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Masukkan kata sandi akun Anda untuk mengaktifkan sesi server.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await reconnectServerSession(password);
      setPassword('');
      if (result.failedCount > 0 && result.lastError) {
        showToast(
          `Sesi terhubung (${result.syncedCount} berhasil disinkronkan, ${result.failedCount} gagal: ${result.lastError}).`,
          'info'
        );
      } else if (result.syncedCount > 0) {
        showToast(
          `Sesi server aktif & ${result.syncedCount} perubahan lokal berhasil disinkronkan!`,
          'success'
        );
      } else {
        showToast('Sesi server berhasil diaktifkan. Fitur AI dan sinkronisasi siap digunakan.', 'success');
      }
      closeReconnectModal();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghubungkan ke server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearQueue = async () => {
    await clearPendingQueue();
    setErrorMsg(null);
    showToast('Antrean perubahan lokal yang tertunda telah dibersihkan.', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F3D2E] text-white">
              <Wifi className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#111C18]">
                Aktifkan Sesi Server & Sinkronkan
              </h3>
              <p className="text-xs text-slate-500">
                Akun: <span className="font-semibold text-[#0F3D2E]">{appUser.displayName}</span>{' '}
                (@{appUser.username || appUser.displayName})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeReconnectModal}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup jendela sinkronisasi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-slate-600">
            Saat ini aplikasi berjalan dengan sesi lokal. Masukkan kata sandi akun Anda untuk mengaktifkan sesi server agar{' '}
            {pendingSyncCount > 0 ? (
              <strong className="text-[#0F3D2E]">
                {pendingSyncCount} perubahan tertunda langsung tersinkronisasi
              </strong>
            ) : (
              'sinkronisasi otomatis'
            )}{' '}
            dan fitur <strong className="text-[#0F3D2E]">Narasi AI</strong> dapat berjalan.
          </p>

          {(errorMsg || lastSyncError) && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              {errorMsg || lastSyncError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Kata Sandi Akun ({appUser.username || appUser.displayName})
              </label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi Anda"
                  className="w-full rounded-lg border border-slate-200 pl-9 pr-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {pendingSyncCount > 0 && lastSyncError ? (
                <button
                  type="button"
                  onClick={handleClearQueue}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Hapus Antrean Gagal
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeReconnectModal}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Nanti Saja
                </button>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${submitting ? 'animate-spin' : ''}`} />
                {submitting
                  ? 'Menghubungkan & Menyinkronkan...'
                  : pendingSyncCount > 0
                  ? `Hubungkan & Sinkronkan (${pendingSyncCount})`
                  : 'Aktifkan Sesi Server'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
