import { Cloud, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const {
    isOfflineSession,
    serverApiAvailable,
    pendingSyncCount,
    pendingFirestoreCount,
    syncing,
    firestoreSyncing,
    firestoreConnected,
    syncNow,
    syncFirestoreNow,
    openReconnectModal,
    openCloudSyncModal,
  } = useAuth();
  const { showToast } = useToast();

  const totalPending = pendingSyncCount + pendingFirestoreCount;

  if (!isOnline) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm"
      >
        <WifiOff className="h-4 w-4 shrink-0 text-[#D97706]" />
        <span>
          Mode Offline — Tersimpan di antrean lokal
          {totalPending > 0 ? ` (${totalPending} perubahan siap sinkron saat online)` : ''}
        </span>
      </div>
    );
  }

  const handleSyncClick = async () => {
    const res = await syncNow();
    if (firestoreConnected && pendingFirestoreCount > 0) {
      const fsRes = await syncFirestoreNow();
      if (fsRes.syncedCount > 0) {
        showToast(`${fsRes.syncedCount} perubahan berhasil disinkronkan ke Firestore.`, 'success');
      }
    }
    if (res.lastError) {
      if (isOfflineSession) return;
      showToast(res.lastError, 'error');
    } else if (res.syncedCount > 0) {
      showToast(`${res.syncedCount} perubahan berhasil disinkronkan ke server.`, 'success');
    }
  };

  if (isOfflineSession) {
    if (!serverApiAvailable) {
      if (totalPending === 0) {
        return null;
      }
      return (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-950 shadow-sm"
        >
          <Cloud className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
          <span>
            Internet terhubung ({totalPending} perubahan siap disinkronkan ke Cloud Firestore).
          </span>
          <button
            type="button"
            onClick={firestoreConnected ? handleSyncClick : openCloudSyncModal}
            disabled={syncing || firestoreSyncing}
            className="rounded bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
          >
            {firestoreConnected
              ? firestoreSyncing
                ? 'Menyinkronkan...'
                : 'Sinkronkan ke Firestore'
              : 'Hubungkan Cloud Firestore'}
          </button>
        </div>
      );
    }

    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-950 shadow-sm"
      >
        {totalPending > 0 ? (
          <RefreshCw
            className={`h-4 w-4 shrink-0 text-[#0F3D2E] ${
              syncing || firestoreSyncing ? 'animate-spin' : ''
            }`}
          />
        ) : (
          <Wifi className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
        )}
        <span>
          {pendingSyncCount > 0
            ? `Internet terhubung (${pendingSyncCount} perubahan menunggu sinkronisasi).`
            : 'Sesi lokal aktif — hubungkan server untuk AI & sinkronisasi otomatis.'}
        </span>
        <button
          type="button"
          onClick={openReconnectModal}
          disabled={syncing}
          className="rounded bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
        >
          {pendingSyncCount > 0 ? 'Hubungkan & Sinkronkan' : 'Aktifkan Sesi Server'}
        </button>
      </div>
    );
  }

  if (pendingSyncCount > 0 || (firestoreConnected && pendingFirestoreCount > 0)) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-950 shadow-sm"
      >
        <RefreshCw
          className={`h-4 w-4 shrink-0 text-[#D97706] ${
            syncing || firestoreSyncing ? 'animate-spin' : ''
          }`}
        />
        <span>
          {pendingSyncCount > 0
            ? `${pendingSyncCount} perubahan menunggu sinkronisasi server`
            : `${pendingFirestoreCount} perubahan menunggu sinkronisasi Firestore`}
          .
        </span>
        <button
          type="button"
          onClick={handleSyncClick}
          disabled={syncing || firestoreSyncing}
          className="rounded bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
        >
          {syncing || firestoreSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
        </button>
      </div>
    );
  }

  if (!firestoreConnected && pendingFirestoreCount > 0) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 shadow-sm"
      >
        <Cloud className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
        <span>
          {pendingFirestoreCount} perubahan lokal siap dikirim ke Cloud Firestore.
        </span>
        <button
          type="button"
          onClick={openCloudSyncModal}
          className="rounded bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#144D3A]"
        >
          Hubungkan Firestore
        </button>
      </div>
    );
  }

  return null;
}
