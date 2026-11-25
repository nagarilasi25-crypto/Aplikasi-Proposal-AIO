import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Terjadi kesalahan sistem yang tidak terduga.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      let parsedMessage = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && parsed.error) {
          parsedMessage = `Akses atau operasi Firestore ditolak (${parsed.operationType} pada ${parsed.path || '-'}): ${parsed.error}`;
        }
      } catch {
        // Keep raw message if not JSON
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F8FAF9] p-6">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8">
            <div className="flex items-center gap-3 text-red-700">
              <AlertCircle className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-semibold">Terjadi Gangguan Aplikasi</h1>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Sistem menangkap kesalahan saat memproses permintaan data. Silakan muat ulang halaman atau hubungi Administrator lembaga.
            </p>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 break-words">
              {parsedMessage}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#144D3A]"
              >
                <RefreshCw className="h-4 w-4" />
                Muat Ulang Halaman
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
