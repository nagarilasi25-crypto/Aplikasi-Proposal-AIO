import { RefreshCw, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAuth } from '../contexts/AuthContext';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const { isOfflineSession, pendingSyncCount, signOutUser } = useAuth();

  if (!isOnline) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm"
      >
        <WifiOff className="h-4 w-4 shrink-0 text-[#D97706]" />
        <span>
          Mode Offline — Data tersimpan lokal{pendingSyncCount > 0 ? ` (${pendingSyncCount} menunggu sinkronisasi)` : ''}
        </span>
      </div>
    );
  }

  if (isOfflineSession && pendingSyncCount > 0) {
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex flex-wrap items-center gap-2.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-950 shadow-sm"
      >
        <RefreshCw className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
        <span>
          Internet terhubung ({pendingSyncCount} perubahan menunggu sinkronisasi).
        </span>
        <button
          type="button"
          onClick={signOutUser}
          className="rounded bg-[#0F3D2E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#144D3A]"
        >
          Masuk Online & Sinkronkan
        </button>
      </div>
    );
  }

  return null;
}
