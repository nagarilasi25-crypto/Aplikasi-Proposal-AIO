import React, { useEffect, useState } from 'react';
import { Cloud, Lock, RefreshCw, ShieldCheck, Trash2, UserCheck, Wifi, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';

export function ReconnectModal() {
  const {
    appUser,
    reconnectModalOpen,
    closeReconnectModal,
    openCloudSyncModal,
    serverApiAvailable,
    firestoreConnected,
    connectFirestoreCloud,
    syncFirestoreNow,
    pendingSyncCount,
    lastSyncError,
    reconnectServerSession,
    clearPendingQueue,
  } = useAuth();
  const { showToast } = useToast();

  const [password, setPassword] = useState('');
  const [needsApprover, setNeedsApprover] = useState(false);
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!reconnectModalOpen) {
      setPassword('');
      setNeedsApprover(false);
      setApproverUsername('');
      setApproverPassword('');
      setErrorMsg(null);
    }
  }, [reconnectModalOpen]);

  if (!reconnectModalOpen || !appUser) return null;

  const handleDirectFirestoreSync = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = firestoreConnected
        ? await syncFirestoreNow()
        : await connectFirestoreCloud();
      if (res.failedCount > 0 && res.lastError) {
        setErrorMsg(res.lastError);
      } else {
        showToast(
          res.syncedCount > 0
            ? `${res.syncedCount} perubahan berhasil disinkronkan ke Cloud Firestore!`
            : 'Seluruh data berhasil disinkronkan ke Cloud Firestore!',
          'success'
        );
        closeReconnectModal();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyinkronkan ke Cloud Firestore.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMsg('Masukkan kata sandi akun Anda untuk mengaktifkan sesi server.');
      return;
    }
    if (needsApprover && !approverPassword) {
      setErrorMsg('Masukkan kata sandi Administrator server aktif (atau Kode Akses Server).');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await reconnectServerSession(
        password,
        needsApprover
          ? {
              approverUsername: approverUsername.trim(),
              approverPassword,
            }
          : undefined
      );
      setPassword('');
      setApproverUsername('');
      setApproverPassword('');
      setNeedsApprover(false);
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
        showToast(
          'Sesi server berhasil diaktifkan. Fitur AI dan sinkronisasi siap digunakan.',
          'success'
        );
      }
      closeReconnectModal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungkan ke server.';
      if (msg.startsWith('NEEDS_APPROVER:')) {
        setNeedsApprover(true);
        setErrorMsg(msg.slice('NEEDS_APPROVER:'.length).trim());
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearQueue = async () => {
    await clearPendingQueue();
    setErrorMsg(null);
    showToast('Antrean perubahan lokal yang tertunda telah dibersihkan.', 'info');
  };

  const displayedError = errorMsg || lastSyncError;
  const showCloudFallbackBtn = Boolean(
    !serverApiAvailable ||
      (displayedError &&
        (displayedError.includes('Cloud Firestore') ||
          displayedError.includes('Server backend (/api)')))
  );

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
          {!serverApiAvailable ? (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950">
              <p className="leading-relaxed">
                Alamat aplikasi ini berjalan tanpa server API lokal. Sinkronisasi data dilakukan langsung melalui{' '}
                <strong className="text-[#0F3D2E]">Cloud Firestore</strong>
                {pendingSyncCount > 0
                  ? ` (${pendingSyncCount} perubahan lokal siap dikirim).`
                  : '.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDirectFirestoreSync}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  {submitting
                    ? 'Menyinkronkan...'
                    : firestoreConnected
                    ? 'Sinkronkan ke Cloud Firestore'
                    : 'Hubungkan Google & Sinkronkan'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeReconnectModal();
                    openCloudSyncModal();
                  }}
                  className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-[#0F3D2E] hover:bg-emerald-50"
                >
                  Lihat Antrean Cloud
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-slate-600">
              Saat ini aplikasi berjalan dengan sesi lokal. Masukkan kata sandi akun Anda untuk
              mengaktifkan sesi server agar{' '}
              {pendingSyncCount > 0 ? (
                <strong className="text-[#0F3D2E]">
                  {pendingSyncCount} perubahan tertunda langsung tersinkronisasi
                </strong>
              ) : (
                'sinkronisasi otomatis'
              )}{' '}
              dan fitur <strong className="text-[#0F3D2E]">Narasi AI</strong> dapat berjalan.
            </p>
          )}

          {displayedError && (
            <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              <p>{displayedError}</p>
              {showCloudFallbackBtn && serverApiAvailable && (
                <button
                  type="button"
                  onClick={handleDirectFirestoreSync}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0F3D2E] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  {firestoreConnected
                    ? 'Sinkronkan ke Cloud Firestore Sekarang'
                    : 'Hubungkan & Sinkronkan via Cloud Firestore'}
                </button>
              )}
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
                  className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>
            </div>

            {needsApprover && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                  <ShieldCheck className="h-4 w-4 text-[#D97706]" />
                  <span>Persetujuan Administrator Server Aktif</span>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700">
                    Nama Pengguna Admin Server (kosongkan jika pakai Kode Akses)
                  </label>
                  <div className="relative mt-1">
                    <UserCheck className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={approverUsername}
                      onChange={(e) => setApproverUsername(e.target.value)}
                      placeholder="Contoh: Lasi"
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700">
                    Kata Sandi Admin Server / Kode Akses Server
                  </label>
                  <div className="relative mt-1">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="password"
                      required
                      value={approverPassword}
                      onChange={(e) => setApproverPassword(e.target.value)}
                      placeholder="Kata sandi Admin server yang sudah aktif"
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

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
