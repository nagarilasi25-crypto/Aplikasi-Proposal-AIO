import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 shadow-sm"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-[#D97706]" />
      <span>Mode Offline — Menggunakan data lokal dan antrean sinkronisasi</span>
    </div>
  );
}
