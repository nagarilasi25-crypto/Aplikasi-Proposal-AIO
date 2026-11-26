import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  LogOut,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useToast } from './Toast';

const COLLECTION_LABELS: Record<string, string> = {
  institutions: 'Profil Lembaga',
  proposalCategories: 'Kategori',
  proposalTemplates: 'Template',
  proposals: 'Proposal',
  proposalBudgets: 'RAB',
  proposalAttachments: 'Lampiran',
  proposalArchives: 'Arsip',
  proposalStatusHistory: 'Riwayat Status',
};

export function CloudSyncModal() {
  const {
    cloudSyncModalOpen,
    closeCloudSyncModal,
    firebaseUser,
    firestoreConnected,
    firestoreQueue,
    pendingFirestoreCount,
    firestoreSyncing,
    lastFirestoreSyncError,
    pendingSyncCount,
    syncing,
    serverApiAvailable,
    hasServerSession,
    connectFirestoreCloud,
    disconnectFirestoreCloud,
    syncFirestoreNow,
    pushAllLocalToFirestore,
    clearFirestoreQueue,
    syncNow,
  } = useAuth();
  const isOnline = useOnlineStatus();
  const { showToast } = useToast();
  const [busyAction, setBusyAction] = useState<'connect' | 'push' | 'sync' | null>(null);

  if (!cloudSyncModalOpen) return null;

  const handleConnect = async () => {
    setBusyAction('connect');
    try {
      const res = await connectFirestoreCloud();
      if (res.failedCount > 0 && res.lastError) {
        showToast(
          `Firestore terhubung (${res.syncedCount} berhasil, ${res.failedCount} gagal: ${res.lastError})`,
          'info'
        );
      } else {
        showToast(
          res.syncedCount > 0
            ? `Firestore terhubung & ${res.syncedCount} data langsung disinkronkan!`
            : 'Firestore Cloud Sync berhasil dihubungkan.',
          'success'
        );
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal menghubungkan akun Google Firestore.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncQueue = async () => {
    setBusyAction('sync');
    try {
      if (pendingSyncCount > 0 && serverApiAvailable && hasServerSession) {
        await syncNow();
      }
      const res = await syncFirestoreNow();
      if (res.lastError) {
        showToast(res.lastError, 'error');
      } else if (res.syncedCount > 0) {
        showToast(`${res.syncedCount} perubahan berhasil dikirim ke Firestore.`, 'success');
      } else {
        showToast('Seluruh antrean Firestore sudah tersinkronisasi.', 'success');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handlePushAll = async () => {
    setBusyAction('push');
    try {
      const res = await pushAllLocalToFirestore();
      if (res.lastError) {
        showToast(
          `Tersinkron ${res.syncedCount} dari ${res.enqueuedCount} item (${res.lastError})`,
          'info'
        );
      } else {
        showToast(
          `${res.syncedCount} data proposal, master, dan RAB berhasil disinkronkan ke Firestore.`,
          'success'
        );
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisconnect = async () => {
    await disconnectFirestoreCloud();
    showToast('Sesi sinkronisasi Firestore diputuskan (akun lokal tetap aktif).', 'info');
  };

  const handleClear = async () => {
    await clearFirestoreQueue();
    showToast('Antrean sinkronisasi Firestore lokal telah dibersihkan.', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0F3D2E] text-white">
              {firestoreConnected ? <Cloud className="h-5 w-5" /> : <CloudOff className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#111C18]">
                Sinkronisasi Latar Belakang & Cloud Firestore
              </h3>
              <p className="text-xs text-slate-500">
                Perubahan offline disimpan di antrean IndexedDB dan otomatis dikirim saat online.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeCloudSyncModal}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup panel sinkronisasi cloud"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Status Summary */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-[11px] font-medium text-slate-500">Status Koneksi & SW Sync</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[#111C18]">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                {isOnline ? 'Internet Terhubung (Auto-Sync Aktif)' : 'Offline (Antrean Lokal Aktif)'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-[11px] font-medium text-slate-500">Koneksi Cloud Firestore</p>
              {firestoreConnected ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-emerald-700">
                    {firebaseUser?.email}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-600"
                  >
                    <LogOut className="h-3 w-3" />
                    Putuskan
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  Belum terhubung ke akun Google
                </p>
              )}
            </div>
          </div>

          {!firestoreConnected && (
            <div className="flex flex-col justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center">
              <div className="text-xs leading-relaxed text-emerald-950">
                <p className="font-semibold">Aktifkan Sinkronisasi Otomatis ke Firestore</p>
                <p className="mt-0.5 text-emerald-900/80">
                  Masuk sekali dengan akun Google Anda agar setiap perubahan proposal offline otomatis dikirim ke Firestore saat online.
                </p>
              </div>
              <button
                type="button"
                onClick={handleConnect}
                disabled={!isOnline || busyAction === 'connect'}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
              >
                <Cloud className="h-3.5 w-3.5" />
                {busyAction === 'connect' ? 'Menghubungkan...' : 'Hubungkan Firestore'}
              </button>
            </div>
          )}

          {lastFirestoreSyncError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{lastFirestoreSyncError}</span>
            </div>
          )}

          {/* Queue List */}
          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[#111C18]">
                Antrean Sinkronisasi Firestore ({pendingFirestoreCount})
              </h4>
              {pendingFirestoreCount > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                  Bersihkan Antrean
                </button>
              )}
            </div>

            {pendingFirestoreCount === 0 ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>Tidak ada perubahan tertunda di antrean Firestore.</span>
              </div>
            ) : (
              <div className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {firestoreQueue.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#0F3D2E]">
                          {COLLECTION_LABELS[item.collection] || item.collection}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="uppercase text-[10px] font-medium text-slate-500">
                          {item.operation === 'delete' ? 'Hapus' : 'Simpan'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-medium text-[#111C18]">{item.label}</p>
                      {item.lastError && (
                        <p className="mt-0.5 text-[11px] text-red-600 break-words">
                          {item.lastError}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                        item.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : item.status === 'syncing'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {item.status === 'failed'
                        ? `Gagal (${item.retryCount}x)`
                        : item.status === 'syncing'
                        ? 'Mengirim...'
                        : 'Menunggu'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={handlePushAll}
            disabled={!isOnline || !firestoreConnected || firestoreSyncing || busyAction !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            {busyAction === 'push' ? 'Mengirim Semua...' : 'Push Semua Data ke Firestore'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeCloudSyncModal}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleSyncQueue}
              disabled={!isOnline || !firestoreConnected || firestoreSyncing || syncing || busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${firestoreSyncing || busyAction === 'sync' ? 'animate-spin' : ''}`}
              />
              {firestoreSyncing || busyAction === 'sync'
                ? 'Menyinkronkan...'
                : 'Sinkronkan Antrean'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
