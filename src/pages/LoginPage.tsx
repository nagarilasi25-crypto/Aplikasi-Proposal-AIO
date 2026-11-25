import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PWAInstallButton } from '../components/PWAInstallButton';

type AuthMode = 'login' | 'register';

export function LoginPage() {
  const {
    signingIn,
    needsSetup,
    pendingStatusUser,
    authError,
    authNotice,
    clearAuthMessages,
    setupFirstAdmin,
    signInWithUsername,
    registerWithUsername,
    signOutUser,
  } = useAuth();

  const isOnline = useOnlineStatus();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isPending = pendingStatusUser?.status === 'pending';
  const isInactive = pendingStatusUser?.status === 'inactive';

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setLocalError(null);
    clearAuthMessages();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthMessages();

    if (needsSetup) {
      if (username.trim().length < 3) {
        setLocalError('Nama pengguna minimal 3 karakter.');
        return;
      }
      if (password.length < 6) {
        setLocalError('Kata sandi minimal 6 karakter.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Konfirmasi kata sandi tidak cocok.');
        return;
      }
      await setupFirstAdmin(username.trim(), displayName.trim() || username.trim(), password);
      return;
    }

    if (mode === 'login') {
      if (!username.trim() || !password) {
        setLocalError('Nama pengguna dan kata sandi wajib diisi.');
        return;
      }
      await signInWithUsername(username.trim(), password);
      return;
    }

    if (mode === 'register') {
      if (username.trim().length < 3) {
        setLocalError('Nama pengguna minimal 3 karakter.');
        return;
      }
      if (password.length < 6) {
        setLocalError('Kata sandi minimal 6 karakter.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Konfirmasi kata sandi tidak cocok.');
        return;
      }
      await registerWithUsername(
        username.trim(),
        displayName.trim() || username.trim(),
        password
      );
    }
  };

  const visibleError = localError || authError;

  return (
    <div className="grid min-h-screen bg-[#F8FAF9] lg:grid-cols-12">
      {/* Left Brand Column */}
      <div className="flex flex-col justify-between bg-[#0F3D2E] p-8 text-white sm:p-12 lg:col-span-5 lg:p-14">
        <div>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#C5A059]">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-display text-base font-bold tracking-tight text-white">
                Proposal Management System
              </p>
              <p className="text-xs text-[#C5A059]">
                Akses Online & Offline Terpadu
              </p>
            </div>
          </div>

          <div className="mt-12 border-t border-white/15 pt-10">
            <p className="text-xs font-medium tracking-wide text-[#C5A059]">
              Sistem Informasi Terpadu
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold leading-tight text-white [text-wrap:balance] sm:text-4xl">
              AR-RAUDHAH PROPOSAL MANAGEMENT SYSTEM
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
              Sistem informasi khusus untuk membuat, mengelola, mencetak, menyimpan, dan mengarsipkan dokumen proposal. Mendukung akses luring (offline) ketika perangkat tidak terhubung ke internet.
            </p>
          </div>
        </div>

        <div className="mt-10 border-t border-white/15 pt-6 text-xs leading-relaxed text-white/70">
          <p className="font-medium text-white">Masuk Menggunakan Nama & Sandi</p>
          <p className="mt-1">
            Tidak memerlukan akun Google maupun integrasi email pengguna.
          </p>
        </div>
      </div>

      {/* Right Authentication Column */}
      <div className="flex items-center justify-center p-6 sm:p-12 lg:col-span-7">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8">
          <div className="mb-5 flex items-center justify-between gap-2">
            {!isOnline ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706]">
                <WifiOff className="h-3.5 w-3.5" />
                Mode Offline Aktif
              </span>
            ) : (
              <span className="text-xs text-slate-400">Siap digunakan offline setelah masuk</span>
            )}
            <PWAInstallButton compact />
          </div>

          {isPending ? (
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#C5A059]/15 text-[#9A742B]">
                <Clock className="h-5 w-5" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold text-[#111C18]">
                Akun Menunggu Aktivasi
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Akun <span className="font-semibold text-[#111C18]">{pendingStatusUser?.username}</span> telah tercatat dengan peran dasar{' '}
                <span className="font-semibold text-[#111C18]">{pendingStatusUser?.role}</span> dan menunggu persetujuan Administrator.
              </p>
              <button
                type="button"
                onClick={signOutUser}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Kembali ke Halaman Masuk
              </button>
            </div>
          ) : isInactive ? (
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <AlertCircle className="h-5 w-5" />
              </div>
              <h2 className="mt-5 font-display text-xl font-bold text-[#111C18]">
                Akses Akun Dinonaktifkan
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Akun <span className="font-medium text-slate-800">{pendingStatusUser?.username}</span> saat ini dinonaktifkan. Hubungi Administrator sistem.
              </p>
              <button
                type="button"
                onClick={signOutUser}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Kembali ke Halaman Masuk
              </button>
            </div>
          ) : (
            <div>
              {!needsSetup && (
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === 'login'
                        ? 'bg-white text-[#0F3D2E] shadow-sm'
                        : 'text-slate-600 hover:text-[#111C18]'
                    }`}
                  >
                    Masuk
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      mode === 'register'
                        ? 'bg-white text-[#0F3D2E] shadow-sm'
                        : 'text-slate-600 hover:text-[#111C18]'
                    }`}
                  >
                    Daftar Akun
                  </button>
                </div>
              )}

              <h2 className="mt-5 font-display text-2xl font-bold text-[#111C18]">
                {needsSetup
                  ? 'Buat Akun Administrator Pertama'
                  : mode === 'login'
                  ? 'Masuk ke Sistem'
                  : 'Daftar Pengguna Baru'}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {needsSetup
                  ? 'Belum ada Administrator terdaftar. Tentukan nama pengguna dan kata sandi Administrator utama.'
                  : mode === 'login'
                  ? 'Masukkan nama pengguna dan kata sandi Anda (tanpa email).'
                  : 'Buat akun baru menggunakan nama pengguna dan kata sandi.'}
              </p>

              {visibleError && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{visibleError}</span>
                </div>
              )}

              {authNotice && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{authNotice}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Nama Pengguna (untuk masuk)
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Contoh: admin atau operator1"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>

                {(needsSetup || mode === 'register') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Nama Lengkap / Tampilan
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Contoh: Ahmad Fauzi"
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Kata Sandi
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete={needsSetup || mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>

                {(needsSetup || mode === 'register') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Konfirmasi Kata Sandi
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ulangi kata sandi"
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={signingIn}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#144D3A] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {needsSetup || mode === 'register' ? (
                    <>
                      <UserPlus className="h-4 w-4" />
                      {signingIn
                        ? 'Memproses...'
                        : needsSetup
                        ? 'Simpan & Masuk sebagai Administrator'
                        : 'Daftarkan Akun'}
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" />
                      {signingIn ? 'Memeriksa...' : 'Masuk'}
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0F3D2E]" />
                  <p>
                    {needsSetup
                      ? 'Pengaturan awal ini hanya muncul satu kali sebelum akun Administrator pertama dibuat.'
                      : 'Pengguna baru yang mendaftar memperoleh peran dasar Operator dengan status menunggu aktivasi Administrator.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
