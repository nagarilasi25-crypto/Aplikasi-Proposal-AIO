import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserSearch,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { UserRole } from '../types/models';

type AuthMode = 'login' | 'register' | 'recover';
type RecoverTab = 'username' | 'reset';

export function LoginPage() {
  const {
    signingIn,
    needsSetup,
    hasEnvAdminPasscode,
    pendingStatusUser,
    authError,
    authNotice,
    clearAuthMessages,
    setupFirstAdmin,
    signInWithUsername,
    registerWithUsername,
    activatePendingWithAdminCredentials,
    recoverUsername,
    resetAccountWithRecovery,
    resetLocalOfflineAuth,
    signOutUser,
  } = useAuth();

  const isOnline = useOnlineStatus();
  const [mode, setMode] = useState<AuthMode>('login');
  const [recoverTab, setRecoverTab] = useState<RecoverTab>('reset');

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [registerRole, setRegisterRole] = useState<UserRole>('Operator');
  const [approverUsername, setApproverUsername] = useState('');
  const [approverPassword, setApproverPassword] = useState('');
  const [promotePendingToAdmin, setPromotePendingToAdmin] = useState(true);
  const [showPendingActivateForm, setShowPendingActivateForm] = useState(false);

  // Forgot username state
  const [lookupDisplayName, setLookupDisplayName] = useState('');
  const [lookupSecret, setLookupSecret] = useState('');
  const [foundUsername, setFoundUsername] = useState<string | null>(null);

  // Account reset state
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewUsername, setResetNewUsername] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverSuccess, setRecoverSuccess] = useState<string | null>(null);

  // Local device emergency reset
  const [showLocalResetConfirm, setShowLocalResetConfirm] = useState(false);
  const [localResetKeyword, setLocalResetKeyword] = useState('');

  const [localError, setLocalError] = useState<string | null>(null);

  const isPending = pendingStatusUser?.status === 'pending';
  const isInactive = pendingStatusUser?.status === 'inactive';

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setLocalError(null);
    setRecoverSuccess(null);
    setFoundUsername(null);
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
      if (recoveryCode.trim() && recoveryCode.trim().length < 4) {
        setLocalError('Kode pemulihan akun minimal 4 karakter jika diisi.');
        return;
      }
      await setupFirstAdmin(
        username.trim(),
        displayName.trim() || username.trim(),
        password,
        recoveryCode.trim() || undefined
      );
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
      if (recoveryCode.trim() && recoveryCode.trim().length < 4) {
        setLocalError('Kode pemulihan akun minimal 4 karakter jika diisi.');
        return;
      }
      if (registerRole === 'Administrator' && !approverPassword) {
        setLocalError(
          'Masukkan nama pengguna dan kata sandi Administrator yang sudah aktif (atau Kode Akses Server) agar akun Administrator baru langsung aktif.'
        );
        return;
      }
      await registerWithUsername(
        username.trim(),
        displayName.trim() || username.trim(),
        password,
        recoveryCode.trim() || undefined,
        {
          role: registerRole,
          approverUsername: approverUsername.trim() || undefined,
          approverPassword: approverPassword || undefined,
        }
      );
    }
  };

  const handlePendingDirectActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthMessages();
    const targetUsername = pendingStatusUser?.username || username.trim();
    if (!targetUsername || !approverPassword) {
      setLocalError('Masukkan kredensial Administrator aktif untuk mengaktifkan akun ini.');
      return;
    }
    await activatePendingWithAdminCredentials({
      username: targetUsername,
      password,
      approverUsername: approverUsername.trim(),
      approverPassword,
      promoteToAdmin: promotePendingToAdmin,
    });
  };

  const handleRecoverUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setRecoverSuccess(null);
    setFoundUsername(null);
    clearAuthMessages();

    if (!lookupDisplayName.trim() || !lookupSecret) {
      setLocalError('Nama lengkap dan kata sandi (atau kode pemulihan) wajib diisi.');
      return;
    }

    setRecoverBusy(true);
    try {
      const res = await recoverUsername(lookupDisplayName.trim(), lookupSecret);
      setFoundUsername(res.username);
      setRecoverSuccess(
        `Nama pengguna untuk "${res.displayName}" ditemukan${res.fromOffline ? ' (data lokal)' : ''}.`
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Gagal mencari nama pengguna.');
    } finally {
      setRecoverBusy(false);
    }
  };

  const handleResetAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setRecoverSuccess(null);
    clearAuthMessages();

    if (!resetIdentifier.trim() || !resetCode.trim() || !resetNewPassword) {
      setLocalError('Nama pengguna/nama lengkap, kode pemulihan, dan kata sandi baru wajib diisi.');
      return;
    }
    if (resetNewPassword.length < 6) {
      setLocalError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setLocalError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    if (resetNewUsername.trim() && resetNewUsername.trim().length < 3) {
      setLocalError('Nama pengguna baru minimal 3 karakter.');
      return;
    }

    setRecoverBusy(true);
    try {
      const res = await resetAccountWithRecovery({
        identifier: resetIdentifier.trim(),
        recoveryCode: resetCode.trim(),
        newUsername: resetNewUsername.trim() || undefined,
        newPassword: resetNewPassword,
      });
      setUsername(res.username);
      setPassword('');
      setResetCode('');
      setResetNewUsername('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setRecoverSuccess(res.message);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Gagal mereset akun.');
    } finally {
      setRecoverBusy(false);
    }
  };

  const handleLocalOfflineReset = async () => {
    if (localResetKeyword.trim().toUpperCase() !== 'RESET') {
      setLocalError('Ketik kata RESET dengan huruf besar untuk mengonfirmasi.');
      return;
    }
    setLocalError(null);
    await resetLocalOfflineAuth();
    setShowLocalResetConfirm(false);
    setLocalResetKeyword('');
    setMode('login');
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

              {(localError || authError) && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{localError || authError}</span>
                </div>
              )}

              {!showPendingActivateForm ? (
                <div className="mt-5 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPendingActivateForm(true);
                      setLocalError(null);
                      clearAuthMessages();
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#144D3A]"
                  >
                    <UserCheck className="h-4 w-4" />
                    Aktifkan Langsung (Saya Administrator)
                  </button>
                  <button
                    type="button"
                    onClick={signOutUser}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Kembali ke Halaman Masuk
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handlePendingDirectActivate}
                  className="mt-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="text-xs font-semibold text-[#111C18]">
                    Verifikasi Administrator Aktif
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Masukkan nama pengguna & kata sandi Administrator yang sudah aktif{hasEnvAdminPasscode ? ' (atau Kode Akses Server)' : ''} untuk langsung mengaktifkan akun <span className="font-mono font-semibold">{pendingStatusUser?.username}</span>.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Nama Pengguna Administrator Aktif{hasEnvAdminPasscode ? ' (opsional jika pakai Kode Server)' : ''}
                    </label>
                    <input
                      type="text"
                      value={approverUsername}
                      onChange={(e) => setApproverUsername(e.target.value)}
                      placeholder="Contoh: Lasi atau admin"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Kata Sandi Administrator{hasEnvAdminPasscode ? ' / Kode Akses Server' : ''}
                    </label>
                    <input
                      type="password"
                      required
                      value={approverPassword}
                      onChange={(e) => setApproverPassword(e.target.value)}
                      placeholder="Masukkan kata sandi Administrator"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={promotePendingToAdmin}
                      onChange={(e) => setPromotePendingToAdmin(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E] focus:ring-[#0F3D2E]"
                    />
                    <span>Aktifkan sebagai Administrator (langsung aktif)</span>
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={signingIn}
                      className="flex-1 rounded-lg bg-[#0F3D2E] px-3 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                    >
                      {signingIn ? 'Mengaktifkan...' : 'Aktifkan & Masuk'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPendingActivateForm(false)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Batal
                    </button>
                  </div>
                </form>
              )}
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
                    className={`flex-1 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors ${
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
                    className={`flex-1 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors ${
                      mode === 'register'
                        ? 'bg-white text-[#0F3D2E] shadow-sm'
                        : 'text-slate-600 hover:text-[#111C18]'
                    }`}
                  >
                    Daftar Akun
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('recover')}
                    className={`flex-1 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors ${
                      mode === 'recover'
                        ? 'bg-white text-[#0F3D2E] shadow-sm'
                        : 'text-slate-600 hover:text-[#111C18]'
                    }`}
                  >
                    Lupa / Reset
                  </button>
                </div>
              )}

              <h2 className="mt-5 font-display text-2xl font-bold text-[#111C18]">
                {needsSetup
                  ? 'Buat Akun Administrator Pertama'
                  : mode === 'login'
                  ? 'Masuk ke Sistem'
                  : mode === 'register'
                  ? 'Daftar Pengguna Baru'
                  : 'Pemulihan & Reset Akun'}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {needsSetup
                  ? 'Belum ada Administrator terdaftar. Tentukan nama pengguna dan kata sandi Administrator utama.'
                  : mode === 'login'
                  ? 'Masukkan nama pengguna dan kata sandi Anda (tanpa email).'
                  : mode === 'register'
                  ? 'Buat akun baru menggunakan nama pengguna dan kata sandi.'
                  : 'Cari nama pengguna yang terlupa atau atur ulang kata sandi menggunakan kode pemulihan.'}
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

              {(authNotice || recoverSuccess) && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{recoverSuccess || authNotice}</span>
                </div>
              )}

              {!needsSetup && mode === 'recover' ? (
                <div className="mt-5 space-y-5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRecoverTab('reset');
                        setLocalError(null);
                        setRecoverSuccess(null);
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        recoverTab === 'reset'
                          ? 'border-[#0F3D2E] bg-[#0F3D2E]/5 text-[#0F3D2E]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset Akun / Sandi
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoverTab('username');
                        setLocalError(null);
                        setRecoverSuccess(null);
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        recoverTab === 'username'
                          ? 'border-[#0F3D2E] bg-[#0F3D2E]/5 text-[#0F3D2E]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <UserSearch className="h-3.5 w-3.5" />
                      Lupa Nama Pengguna
                    </button>
                  </div>

                  {recoverTab === 'username' ? (
                    <form onSubmit={handleRecoverUsername} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Nama Lengkap / Tampilan
                        </label>
                        <input
                          type="text"
                          required
                          value={lookupDisplayName}
                          onChange={(e) => setLookupDisplayName(e.target.value)}
                          placeholder="Sesuai nama lengkap yang didaftarkan"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Kata Sandi atau Kode Pemulihan Akun
                        </label>
                        <input
                          type="password"
                          required
                          value={lookupSecret}
                          onChange={(e) => setLookupSecret(e.target.value)}
                          placeholder="Masukkan kata sandi atau kode pemulihan"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>

                      {foundUsername && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5">
                          <p className="text-xs text-emerald-800">Nama Pengguna Anda:</p>
                          <p className="mt-1 font-mono text-base font-bold text-[#0F3D2E]">
                            {foundUsername}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setUsername(foundUsername);
                              switchMode('login');
                            }}
                            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#144D3A]"
                          >
                            <LogIn className="h-3.5 w-3.5" />
                            Masuk dengan Nama Ini
                          </button>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={recoverBusy}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                      >
                        <UserSearch className="h-4 w-4" />
                        {recoverBusy ? 'Mencari...' : 'Cari Nama Pengguna'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleResetAccount} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Nama Pengguna atau Nama Lengkap
                        </label>
                        <input
                          type="text"
                          required
                          value={resetIdentifier}
                          onChange={(e) => setResetIdentifier(e.target.value)}
                          placeholder="Contoh: admin atau Ahmad Fauzi"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Kode Pemulihan Akun{hasEnvAdminPasscode ? ' (atau Kode Akses Server)' : ''}
                        </label>
                        <input
                          type="password"
                          required
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value)}
                          placeholder="Kode pemulihan yang dibuat saat pendaftaran/pengaturan"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Nama Pengguna Baru (Opsional)
                        </label>
                        <input
                          type="text"
                          value={resetNewUsername}
                          onChange={(e) => setResetNewUsername(e.target.value)}
                          placeholder="Kosongkan jika tidak mengubah nama pengguna"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700">
                            Kata Sandi Baru
                          </label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={resetNewPassword}
                            onChange={(e) => setResetNewPassword(e.target.value)}
                            placeholder="Minimal 6 karakter"
                            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700">
                            Ulangi Sandi Baru
                          </label>
                          <input
                            type="password"
                            required
                            minLength={6}
                            value={resetConfirmPassword}
                            onChange={(e) => setResetConfirmPassword(e.target.value)}
                            placeholder="Konfirmasi sandi"
                            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={recoverBusy}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                      >
                        <RotateCcw className="h-4 w-4" />
                        {recoverBusy ? 'Memproses...' : 'Reset Nama / Sandi Akun'}
                      </button>

                      {recoverSuccess && (
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                          Lanjut ke Halaman Masuk
                        </button>
                      )}
                    </form>
                  )}

                  {/* Local Device Emergency Reset */}
                  <div className="border-t border-slate-100 pt-4">
                    {!showLocalResetConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowLocalResetConfirm(true)}
                        className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-700 hover:underline"
                      >
                        Lupa total akun lokal perangkat ini? Reset penyimpanan akun lokal
                      </button>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 space-y-2.5">
                        <p className="text-xs font-semibold text-amber-950">
                          Reset Data Akun Lokal Peramban
                        </p>
                        <p className="text-[11px] leading-relaxed text-amber-900">
                          Tindakan ini menghapus cache akun pada peramban ini saja (data lembaga dan server tidak terhapus). Ketik <span className="font-mono font-bold">RESET</span> untuk melanjutkan.
                        </p>
                        <input
                          type="text"
                          value={localResetKeyword}
                          onChange={(e) => setLocalResetKeyword(e.target.value)}
                          placeholder="Ketik RESET"
                          className="w-full rounded-md border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleLocalOfflineReset}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            Konfirmasi Reset Lokal
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowLocalResetConfirm(false);
                              setLocalResetKeyword('');
                            }}
                            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
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
                    <>
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

                      {!needsSetup && mode === 'register' && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-700">
                              Peran yang Didaftarkan
                            </label>
                            <select
                              value={registerRole}
                              onChange={(e) => setRegisterRole(e.target.value as UserRole)}
                              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                            >
                              <option value="Operator">Operator (Menunggu Aktivasi Administrator)</option>
                              <option value="Administrator">Administrator (Langsung Aktif)</option>
                            </select>
                          </div>

                          {registerRole === 'Administrator' && (
                            <div className="rounded-lg border border-[#0F3D2E]/20 bg-[#0F3D2E]/5 p-3.5 space-y-2.5">
                              <p className="text-xs font-semibold text-[#0F3D2E]">
                                Verifikasi Administrator Aktif
                              </p>
                              <p className="text-[11px] leading-relaxed text-slate-600">
                                Agar akun Administrator baru ini langsung aktif tanpa menunggu persetujuan, masukkan nama & sandi Administrator yang sudah ada{hasEnvAdminPasscode ? ' (atau Kode Akses Server)' : ''}.
                              </p>
                              <input
                                type="text"
                                value={approverUsername}
                                onChange={(e) => setApproverUsername(e.target.value)}
                                placeholder={
                                  hasEnvAdminPasscode
                                    ? 'Nama pengguna Admin aktif (opsional jika pakai Kode Server)'
                                    : 'Nama pengguna Administrator yang sudah aktif'
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                              />
                              <input
                                type="password"
                                required
                                value={approverPassword}
                                onChange={(e) => setApproverPassword(e.target.value)}
                                placeholder={
                                  hasEnvAdminPasscode
                                    ? 'Kata sandi Admin aktif / Kode Akses Server'
                                    : 'Kata sandi Administrator yang sudah aktif'
                                }
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-slate-700">
                          Kode Pemulihan Akun (Opsional · min. 4 karakter)
                        </label>
                        <input
                          type="text"
                          minLength={4}
                          maxLength={64}
                          value={recoveryCode}
                          onChange={(e) => setRecoveryCode(e.target.value)}
                          placeholder="Untuk reset mandiri jika lupa nama/sandi"
                          className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                        />
                      </div>
                    </>
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
              )}

              <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0F3D2E]" />
                  <p>
                    {needsSetup
                      ? 'Pengaturan awal ini hanya muncul satu kali sebelum akun Administrator pertama dibuat.'
                      : mode === 'recover'
                      ? 'Jika kode pemulihan belum diatur, Administrator tetap dapat mereset nama pengguna dan kata sandi melalui menu Manajemen Pengguna.'
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
