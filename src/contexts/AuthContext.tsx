import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AppUser,
  DEFAULT_INSTITUTION_SEED,
  InstitutionProfile,
  ProposalCategory,
  ProposalRecord,
} from '../types/models';
import {
  cacheDashboardSnapshot,
  cacheOfflineAuthCredential,
  enqueueOfflineMutation,
  getOfflineKV,
  getOfflineMutationQueue,
  hasAnyOfflineAccount,
  hasOfflineUsername,
  removeOfflineMutation,
  setOfflineKV,
  verifyOfflineAuthCredentialDetailed,
} from '../lib/offlineDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface ParsedApiResponse<T> {
  ok: boolean;
  status: number;
  isJson: boolean;
  data: T | null;
}

async function parseJsonResponse<T = Record<string, unknown>>(
  res: Response
): Promise<ParsedApiResponse<T>> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return { ok: false, status: res.status, isJson: false, data: null };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: res.ok, status: res.status, isJson: false, data: null };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    if (parsed !== null && typeof parsed === 'object') {
      return { ok: res.ok, status: res.status, isJson: true, data: parsed };
    }
    return { ok: false, status: res.status, isJson: false, data: null };
  } catch {
    return { ok: false, status: res.status, isJson: false, data: null };
  }
}

interface AuthContextValue {
  appUser: AppUser | null;
  institution: InstitutionProfile | null;
  proposals: ProposalRecord[];
  categories: ProposalCategory[];
  authLoading: boolean;
  institutionLoading: boolean;
  signingIn: boolean;
  needsSetup: boolean;
  hasEnvAdminPasscode: boolean;
  isOfflineSession: boolean;
  pendingSyncCount: number;
  pendingStatusUser: AppUser | null;
  authError: string | null;
  authNotice: string | null;
  clearAuthMessages: () => void;
  setupFirstAdmin: (username: string, displayName: string, password: string) => Promise<void>;
  signInWithUsername: (username: string, password: string) => Promise<void>;
  registerWithUsername: (username: string, displayName: string, password: string) => Promise<void>;
  signOutUser: () => void;
  apiRequest: <T = unknown>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
    }
  ) => Promise<T>;
  saveInstitution: (payload: InstitutionProfile) => Promise<{ queuedOffline: boolean }>;
  updateOwnProfile: (payload: {
    displayName: string;
    phone: string;
    position: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<{ queuedOffline: boolean }>;
  refreshDashboardData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const EMPTY_INSTITUTION: InstitutionProfile = {
  ...DEFAULT_INSTITUTION_SEED,
  createdBy: '',
  updatedBy: '',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isOnline = useOnlineStatus();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [categories, setCategories] = useState<ProposalCategory[]>([]);

  const [authLoading, setAuthLoading] = useState(true);
  const [institutionLoading, setInstitutionLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasEnvAdminPasscode, setHasEnvAdminPasscode] = useState(false);
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [pendingStatusUser, setPendingStatusUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const refreshQueueCount = useCallback(async () => {
    const queue = await getOfflineMutationQueue();
    setPendingSyncCount(queue.length);
  }, []);

  const checkBootstrapStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/bootstrap-status', {
        headers: { Accept: 'application/json' },
      });
      const parsed = await parseJsonResponse<{
        needsSetup?: boolean;
        hasEnvAdminPasscode?: boolean;
      }>(res);
      if (parsed.ok && parsed.isJson && typeof parsed.data?.needsSetup === 'boolean') {
        setNeedsSetup(parsed.data.needsSetup);
        setHasEnvAdminPasscode(Boolean(parsed.data.hasEnvAdminPasscode));
        return;
      }
      const hasLocal = await hasAnyOfflineAccount();
      setNeedsSetup(!hasLocal);
      setHasEnvAdminPasscode(false);
    } catch {
      const hasLocal = await hasAnyOfflineAccount();
      setNeedsSetup(!hasLocal);
      setHasEnvAdminPasscode(false);
    } finally {
      await refreshQueueCount();
      setAuthLoading(false);
    }
  }, [refreshQueueCount]);

  useEffect(() => {
    checkBootstrapStatus();
  }, [checkBootstrapStatus]);

  const apiRequest = useCallback(
    async <T = unknown,>(
      url: string,
      options?: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: Record<string, unknown>;
      }
    ): Promise<T> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }

      const res = await fetch(url, {
        method: options?.method || 'GET',
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      const parsed = await parseJsonResponse<T & { error?: string }>(res);
      if (!parsed.isJson) {
        throw new Error('Layanan server tidak merespons dengan benar. Coba beberapa saat lagi.');
      }
      if (!parsed.ok) {
        throw new Error(parsed.data?.error || 'Permintaan gagal diproses.');
      }
      return parsed.data as T;
    },
    [sessionToken]
  );

  const refreshDashboardData = useCallback(async () => {
    setInstitutionLoading(true);
    try {
      if (isOnline && sessionToken) {
        const data = await apiRequest<{
          institution: InstitutionProfile;
          proposals: ProposalRecord[];
          categories: ProposalCategory[];
        }>('/api/dashboard-data');
        setInstitution(data.institution || EMPTY_INSTITUTION);
        setProposals(data.proposals || []);
        setCategories(data.categories || []);
        await cacheDashboardSnapshot({
          institution: data.institution || EMPTY_INSTITUTION,
          proposals: data.proposals || [],
          categories: data.categories || [],
        });
      } else {
        const [cachedInst, cachedProps, cachedCats] = await Promise.all([
          getOfflineKV<InstitutionProfile>('institution'),
          getOfflineKV<ProposalRecord[]>('proposals'),
          getOfflineKV<ProposalCategory[]>('categories'),
        ]);
        setInstitution(cachedInst || EMPTY_INSTITUTION);
        setProposals(cachedProps || []);
        setCategories(cachedCats || []);
      }
    } catch {
      const [cachedInst, cachedProps, cachedCats] = await Promise.all([
        getOfflineKV<InstitutionProfile>('institution'),
        getOfflineKV<ProposalRecord[]>('proposals'),
        getOfflineKV<ProposalCategory[]>('categories'),
      ]);
      setInstitution(cachedInst || EMPTY_INSTITUTION);
      setProposals(cachedProps || []);
      setCategories(cachedCats || []);
    } finally {
      setInstitutionLoading(false);
    }
  }, [apiRequest, isOnline, sessionToken]);

  // Flush queued offline mutations when internet & session token are available
  useEffect(() => {
    if (!isOnline || !sessionToken || !appUser) return;

    let cancelled = false;
    const flushQueue = async () => {
      const queue = await getOfflineMutationQueue();
      if (queue.length === 0) return;
      for (const item of queue) {
        if (cancelled) break;
        try {
          await apiRequest(item.endpoint, {
            method: item.method,
            body: item.body,
          });
          await removeOfflineMutation(item.id);
        } catch {
          break;
        }
      }
      await refreshQueueCount();
      await refreshDashboardData();
    };

    flushQueue();
    return () => {
      cancelled = true;
    };
  }, [isOnline, sessionToken, appUser, apiRequest, refreshQueueCount, refreshDashboardData]);

  const applyAuthenticatedSession = async (
    username: string,
    password: string,
    token: string,
    user: AppUser,
    inst: InstitutionProfile
  ) => {
    setSessionToken(token);
    setAppUser(user);
    setInstitution(inst || EMPTY_INSTITUTION);
    setPendingStatusUser(null);
    setIsOfflineSession(false);
    setNeedsSetup(false);

    await cacheOfflineAuthCredential(username, password, user);
    await setOfflineKV('institution', inst || EMPTY_INSTITUTION);
    await refreshQueueCount();
  };

  const applyLocalOfflineSession = async (user: AppUser) => {
    setSessionToken(null);
    setAppUser(user);
    setIsOfflineSession(true);
    setPendingStatusUser(null);
    setNeedsSetup(false);
    await refreshDashboardData();
  };

  const setupFirstAdmin = async (username: string, displayName: string, password: string) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      if (navigator.onLine) {
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ username, displayName, password }),
        });
        const parsed = await parseJsonResponse<{
          token?: string;
          user?: AppUser;
          institution?: InstitutionProfile;
          error?: string;
        }>(res);

        if (parsed.isJson) {
          if (!parsed.ok || !parsed.data?.token || !parsed.data?.user) {
            throw new Error(parsed.data?.error || 'Gagal membuat akun Administrator pertama.');
          }
          await applyAuthenticatedSession(
            username,
            password,
            parsed.data.token,
            parsed.data.user,
            parsed.data.institution || EMPTY_INSTITUTION
          );
          return;
        }
      }

      // Offline / static hosting fallback for initial setup
      const hasLocal = await hasAnyOfflineAccount();
      if (hasLocal) {
        setNeedsSetup(false);
        setAuthError('Akun Administrator sudah terdaftar pada perangkat ini. Silakan masuk.');
        return;
      }

      const now = new Date().toISOString();
      const localUid = `local_admin_${Date.now()}`;
      const localAdmin: AppUser = {
        uid: localUid,
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        email: '',
        phone: '',
        position: 'Administrator Sistem',
        role: 'Administrator',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: localUid,
        updatedBy: localUid,
      };
      await cacheOfflineAuthCredential(username, password, localAdmin);
      await setOfflineKV('institution', EMPTY_INSTITUTION);
      await applyLocalOfflineSession(localAdmin);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Tidak dapat terhubung ke server untuk pengaturan awal.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const signInWithUsername = async (username: string, password: string) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);

    let serverUnavailable = !navigator.onLine;

    try {
      if (navigator.onLine) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });
        const parsed = await parseJsonResponse<{
          code?: string;
          error?: string;
          token?: string;
          user?: AppUser;
          institution?: InstitutionProfile;
        }>(res);

        if (parsed.isJson) {
          if (!parsed.ok) {
            if (
              (parsed.data?.code === 'ACCOUNT_PENDING' ||
                parsed.data?.code === 'ACCOUNT_INACTIVE') &&
              parsed.data.user
            ) {
              setPendingStatusUser(parsed.data.user);
              return;
            }
            throw new Error(parsed.data?.error || 'Nama atau kata sandi tidak sesuai.');
          }
          if (!parsed.data?.token || !parsed.data?.user) {
            throw new Error('Respons autentikasi dari server tidak lengkap.');
          }
          await applyAuthenticatedSession(
            username,
            password,
            parsed.data.token,
            parsed.data.user,
            parsed.data.institution || EMPTY_INSTITUTION
          );
          return;
        }

        // Proxy/CDN returned non-JSON (e.g. 404 "The page could not be found" or 502/503)
        serverUnavailable = true;
      }
    } catch (err) {
      const isNetworkIssue = !navigator.onLine || err instanceof TypeError;
      if (!isNetworkIssue) {
        setAuthError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
        setSigningIn(false);
        return;
      }
      serverUnavailable = true;
    }

    // Offline or server-unavailable fallback: verify locally against PBKDF2-SHA256 cache in IndexedDB
    try {
      if (serverUnavailable) {
        const localCheck = await verifyOfflineAuthCredentialDetailed(username, password);
        if (localCheck.status === 'ok') {
          if (localCheck.user.status === 'pending' || localCheck.user.status === 'inactive') {
            setPendingStatusUser(localCheck.user);
            return;
          }
          await applyLocalOfflineSession(localCheck.user);
          return;
        }
        if (localCheck.status === 'wrong_password') {
          setAuthError('Nama atau kata sandi tidak sesuai.');
          return;
        }
        setAuthError(
          !navigator.onLine
            ? 'Perangkat sedang offline dan akun ini belum pernah masuk sebelumnya pada peramban ini.'
            : 'Layanan server sedang tidak tersedia dan akun ini belum tersimpan secara lokal di peramban ini.'
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const registerWithUsername = async (username: string, displayName: string, password: string) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      if (!navigator.onLine) {
        throw new Error('Pendaftaran akun baru memerlukan koneksi internet.');
      }
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ username, displayName, password }),
      });
      const parsed = await parseJsonResponse<{
        message?: string;
        error?: string;
        user?: AppUser;
      }>(res);

      if (parsed.isJson) {
        if (!parsed.ok) {
          throw new Error(parsed.data?.error || 'Gagal mendaftarkan akun.');
        }
        setAuthNotice(
          parsed.data?.message ||
            'Pendaftaran berhasil. Menunggu aktivasi oleh Administrator.'
        );
        return;
      }

      // Non-JSON response (e.g., static preview / server endpoint unavailable)
      const hasLocal = await hasAnyOfflineAccount();
      if (!hasLocal) {
        throw new Error(
          'Layanan server sedang tidak tersedia. Muat ulang halaman atau coba beberapa saat lagi.'
        );
      }
      const existsLocally = await hasOfflineUsername(username);
      if (existsLocally) {
        throw new Error('Nama pengguna tersebut sudah terdaftar. Gunakan nama lain.');
      }
      const now = new Date().toISOString();
      const localUid = `local_usr_${Date.now()}`;
      const localPendingUser: AppUser = {
        uid: localUid,
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        email: '',
        phone: '',
        position: '',
        role: 'Operator',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        createdBy: localUid,
        updatedBy: localUid,
      };
      await cacheOfflineAuthCredential(username, password, localPendingUser);
      setAuthNotice(
        'Pendaftaran dicatat pada perangkat ini dengan status Menunggu Aktivasi oleh Administrator.'
      );
    } catch (err) {
      if (err instanceof TypeError) {
        setAuthError('Tidak dapat terhubung ke server pendaftaran. Periksa koneksi internet Anda.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Gagal mendaftarkan akun.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const saveInstitution = async (
    payload: InstitutionProfile
  ): Promise<{ queuedOffline: boolean }> => {
    setInstitution(payload);
    await setOfflineKV('institution', payload);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ institution: InstitutionProfile }>('/api/institution', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
        setInstitution(res.institution);
        await setOfflineKV('institution', res.institution);
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: '/api/institution',
      method: 'PUT',
      body: payload as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const updateOwnProfile = async (payload: {
    displayName: string;
    phone: string;
    position: string;
    currentPassword?: string;
    newPassword?: string;
  }): Promise<{ queuedOffline: boolean }> => {
    if (!appUser) throw new Error('Pengguna tidak terautentikasi.');

    if (navigator.onLine && sessionToken) {
      const res = await apiRequest<{ user: AppUser }>('/api/auth/me', {
        method: 'PATCH',
        body: payload as unknown as Record<string, unknown>,
      });
      setAppUser(res.user);
      if (payload.newPassword && res.user.username) {
        await cacheOfflineAuthCredential(res.user.username, payload.newPassword, res.user);
      }
      return { queuedOffline: false };
    }

    const updatedLocal: AppUser = {
      ...appUser,
      displayName: payload.displayName,
      phone: payload.phone,
      position: payload.position,
    };
    setAppUser(updatedLocal);
    await enqueueOfflineMutation({
      endpoint: '/api/auth/me',
      method: 'PATCH',
      body: {
        displayName: payload.displayName,
        phone: payload.phone,
        position: payload.position,
      },
    });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const signOutUser = () => {
    setSessionToken(null);
    setAppUser(null);
    setInstitution(null);
    setProposals([]);
    setCategories([]);
    setPendingStatusUser(null);
    setIsOfflineSession(false);
    setAuthError(null);
    setAuthNotice(null);
  };

  // Initial dashboard fetch once authenticated
  useEffect(() => {
    if (appUser && appUser.status === 'active') {
      refreshDashboardData();
    }
  }, [appUser, refreshDashboardData]);

  return (
    <AuthContext.Provider
      value={{
        appUser,
        institution,
        proposals,
        categories,
        authLoading,
        institutionLoading,
        signingIn,
        needsSetup,
        hasEnvAdminPasscode,
        isOfflineSession,
        pendingSyncCount,
        pendingStatusUser,
        authError,
        authNotice,
        clearAuthMessages: () => {
          setAuthError(null);
          setAuthNotice(null);
          setPendingStatusUser(null);
        },
        setupFirstAdmin,
        signInWithUsername,
        registerWithUsername,
        signOutUser,
        apiRequest,
        saveInstitution,
        updateOwnProfile,
        refreshDashboardData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
