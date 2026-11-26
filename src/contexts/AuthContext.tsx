import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AppUser,
  DEFAULT_INSTITUTION_SEED,
  InstitutionProfile,
  ProposalCategory,
  ProposalRecord,
  UserRole,
} from '../types/models';
import {
  cacheDashboardSnapshot,
  cacheOfflineAuthCredential,
  clearAllOfflineAuthAccounts,
  enqueueOfflineMutation,
  getOfflineKV,
  getOfflineMutationQueue,
  hasActiveOfflineAdmin,
  hasOfflineUsername,
  recoverOfflineUsername,
  removeOfflineMutation,
  resetOfflineAccount,
  setOfflineKV,
  updateOfflineAuthUserMetadata,
  verifyActiveOfflineAdmin,
  verifyOfflineAuthCredentialDetailed,
} from '../lib/offlineDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface ParsedApiResponse<T> {
  ok: boolean;
  status: number;
  isJson: boolean;
  data: T | null;
}

class RecoverableTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoverableTransportError';
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload) return fallback;
  if (typeof payload === 'string') {
    const clean = payload.trim();
    return clean && clean !== '[object Object]' ? clean : fallback;
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error.trim()) {
      return obj.error.trim();
    }
    if (obj.error && typeof obj.error === 'object') {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message.trim();
      }
    }
    if (typeof obj.message === 'string' && obj.message.trim()) {
      return obj.message.trim();
    }
  }
  return fallback;
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
  setupFirstAdmin: (
    username: string,
    displayName: string,
    password: string,
    recoveryCode?: string
  ) => Promise<void>;
  signInWithUsername: (username: string, password: string) => Promise<void>;
  registerWithUsername: (
    username: string,
    displayName: string,
    password: string,
    recoveryCode?: string,
    options?: {
      role?: UserRole;
      approverUsername?: string;
      approverPassword?: string;
    }
  ) => Promise<void>;
  activatePendingWithAdminCredentials: (payload: {
    username: string;
    password: string;
    approverUsername: string;
    approverPassword: string;
    promoteToAdmin: boolean;
  }) => Promise<void>;
  recoverUsername: (
    displayName: string,
    secret: string
  ) => Promise<{ username: string; displayName: string; fromOffline: boolean }>;
  resetAccountWithRecovery: (payload: {
    identifier: string;
    recoveryCode: string;
    newUsername?: string;
    newPassword: string;
  }) => Promise<{ username: string; message: string; fromOffline: boolean }>;
  resetLocalOfflineAuth: () => Promise<void>;
  signOutUser: () => void;
  apiRequest: <T = unknown>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
    }
  ) => Promise<T>;
  uploadInstitutionImage: (
    field: 'logoUrl' | 'photoUrl',
    dataUrl: string,
    baseProfile?: InstitutionProfile
  ) => Promise<{ url: string; queuedOffline: boolean }>;
  saveInstitution: (payload: InstitutionProfile) => Promise<{ queuedOffline: boolean }>;
  updateOwnProfile: (payload: {
    displayName: string;
    phone: string;
    position: string;
    currentPassword?: string;
    newPassword?: string;
    recoveryCode?: string;
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
      const hasLocalAdmin = await hasActiveOfflineAdmin();
      setNeedsSetup(!hasLocalAdmin);
      setHasEnvAdminPasscode(false);
    } catch {
      const hasLocalAdmin = await hasActiveOfflineAdmin();
      setNeedsSetup(!hasLocalAdmin);
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

      const parsed = await parseJsonResponse<T & { error?: unknown }>(res);
      if (!parsed.isJson || res.status === 404 || res.status >= 500) {
        throw new RecoverableTransportError(
          extractErrorMessage(
            parsed.data,
            'Layanan server tidak merespons dengan benar. Coba beberapa saat lagi.'
          )
        );
      }
      if (!parsed.ok) {
        throw new Error(extractErrorMessage(parsed.data, 'Permintaan gagal diproses.'));
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

        // Preserve any locally queued institution draft until queue flush finishes
        const pendingQueue = await getOfflineMutationQueue();
        const hasPendingInst = pendingQueue.some((m) => m.endpoint === '/api/institution');
        const cachedInst = hasPendingInst
          ? await getOfflineKV<InstitutionProfile>('institution')
          : null;
        const effectiveInst = cachedInst || data.institution || EMPTY_INSTITUTION;

        setInstitution(effectiveInst);
        setProposals(data.proposals || []);
        setCategories(data.categories || []);
        await cacheDashboardSnapshot({
          institution: effectiveInst,
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

  // Flush queued offline mutations automatically when internet & session token are available
  useEffect(() => {
    if (!isOnline || !sessionToken || !appUser) return;

    let cancelled = false;
    const flushQueue = async () => {
      const queue = await getOfflineMutationQueue();
      if (queue.length === 0) return;

      let syncedAny = false;
      for (const item of queue) {
        if (cancelled) break;
        try {
          await apiRequest(item.endpoint, {
            method: item.method,
            body: item.body,
          });
          await removeOfflineMutation(item.id);
          syncedAny = true;
        } catch (err) {
          // Stop on transport outage; drop permanent 4xx rejection only if auth not broken
          if (err instanceof TypeError || err instanceof RecoverableTransportError) {
            break;
          }
          break;
        }
      }
      await refreshQueueCount();
      if (syncedAny && !cancelled) {
        await refreshDashboardData();
      }
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
    inst: InstitutionProfile,
    recoveryCode?: string
  ) => {
    const pendingQueue = await getOfflineMutationQueue();
    const hasPendingInst = pendingQueue.some((m) => m.endpoint === '/api/institution');
    const cachedInst = hasPendingInst
      ? await getOfflineKV<InstitutionProfile>('institution')
      : null;
    const effectiveInst = cachedInst || inst || EMPTY_INSTITUTION;

    setSessionToken(token);
    setAppUser(user);
    setInstitution(effectiveInst);
    setPendingStatusUser(null);
    setIsOfflineSession(false);
    setNeedsSetup(false);

    await cacheOfflineAuthCredential(username, password, user, recoveryCode);
    await setOfflineKV('institution', effectiveInst);
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

  const setupFirstAdmin = async (
    username: string,
    displayName: string,
    password: string,
    recoveryCode?: string
  ) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);
    const cleanRecovery = recoveryCode?.trim() || undefined;
    try {
      if (navigator.onLine) {
        try {
          const res = await fetch('/api/auth/setup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              username,
              displayName,
              password,
              recoveryCode: cleanRecovery,
            }),
          });
          const parsed = await parseJsonResponse<{
            token?: string;
            user?: AppUser;
            institution?: InstitutionProfile;
            error?: unknown;
          }>(res);

          const isEdgeOrProxyUnavailable =
            !parsed.isJson || res.status === 404 || res.status >= 500;

          if (!isEdgeOrProxyUnavailable) {
            if (!parsed.ok || !parsed.data?.token || !parsed.data?.user) {
              throw new Error(
                extractErrorMessage(parsed.data, 'Gagal membuat akun Administrator pertama.')
              );
            }
            await applyAuthenticatedSession(
              username,
              password,
              parsed.data.token,
              parsed.data.user,
              parsed.data.institution || EMPTY_INSTITUTION,
              cleanRecovery
            );
            return;
          }
        } catch (err) {
          if (!(err instanceof TypeError)) {
            throw err;
          }
        }
      }

      // Offline / static hosting fallback for initial setup
      const hasLocalAdmin = await hasActiveOfflineAdmin();
      if (hasLocalAdmin) {
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
        hasRecoveryCode: Boolean(cleanRecovery && cleanRecovery.length >= 4),
        createdAt: now,
        updatedAt: now,
        createdBy: localUid,
        updatedBy: localUid,
      };
      await cacheOfflineAuthCredential(username, password, localAdmin, cleanRecovery);
      await setOfflineKV('institution', EMPTY_INSTITUTION);
      await applyLocalOfflineSession(localAdmin);
    } catch (err) {
      setAuthError(
        extractErrorMessage(
          err instanceof Error ? err.message : err,
          'Tidak dapat terhubung ke server untuk pengaturan awal.'
        )
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
          error?: unknown;
          token?: string;
          user?: AppUser;
          institution?: InstitutionProfile;
        }>(res);

        const isEdgeOrProxyUnavailable =
          !parsed.isJson || res.status === 404 || res.status >= 500;

        if (!isEdgeOrProxyUnavailable) {
          if (!parsed.ok) {
            if (
              (parsed.data?.code === 'ACCOUNT_PENDING' ||
                parsed.data?.code === 'ACCOUNT_INACTIVE') &&
              parsed.data.user
            ) {
              setPendingStatusUser(parsed.data.user);
              return;
            }
            throw new Error(
              extractErrorMessage(parsed.data, 'Nama atau kata sandi tidak sesuai.')
            );
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

        serverUnavailable = true;
      }
    } catch (err) {
      const isNetworkIssue = !navigator.onLine || err instanceof TypeError;
      if (!isNetworkIssue) {
        setAuthError(
          extractErrorMessage(err instanceof Error ? err.message : err, 'Gagal masuk ke sistem.')
        );
        setSigningIn(false);
        return;
      }
      serverUnavailable = true;
    }

    try {
      if (serverUnavailable) {
        const localCheck = await verifyOfflineAuthCredentialDetailed(username, password);
        if (localCheck.status === 'ok') {
          if (localCheck.user.status === 'pending') {
            if (localCheck.user.role === 'Administrator') {
              const promoted =
                (await updateOfflineAuthUserMetadata(localCheck.user.uid, {
                  status: 'active',
                  updatedBy: localCheck.user.uid,
                })) || { ...localCheck.user, status: 'active' as const };
              await applyLocalOfflineSession(promoted);
              return;
            }
            setPendingStatusUser(localCheck.user);
            return;
          }
          if (localCheck.user.status === 'inactive') {
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

  const registerWithUsername = async (
    username: string,
    displayName: string,
    password: string,
    recoveryCode?: string,
    options?: {
      role?: UserRole;
      approverUsername?: string;
      approverPassword?: string;
    }
  ) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);
    const cleanRecovery = recoveryCode?.trim() || undefined;
    const requestedRole: UserRole = options?.role === 'Administrator' ? 'Administrator' : 'Operator';

    try {
      let serverUnavailable = !navigator.onLine;

      if (navigator.onLine) {
        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              username,
              displayName,
              password,
              recoveryCode: cleanRecovery,
              role: requestedRole,
              approverUsername: options?.approverUsername?.trim() || undefined,
              approverPassword: options?.approverPassword || undefined,
            }),
          });
          const parsed = await parseJsonResponse<{
            autoActivated?: boolean;
            message?: string;
            error?: unknown;
            token?: string;
            user?: AppUser;
            institution?: InstitutionProfile;
          }>(res);

          const isEdgeOrProxyUnavailable =
            !parsed.isJson || res.status === 404 || res.status >= 500;

          if (!isEdgeOrProxyUnavailable) {
            if (!parsed.ok) {
              throw new Error(extractErrorMessage(parsed.data, 'Gagal mendaftarkan akun.'));
            }
            if (parsed.data?.autoActivated && parsed.data?.token && parsed.data?.user) {
              await applyAuthenticatedSession(
                username,
                password,
                parsed.data.token,
                parsed.data.user,
                parsed.data.institution || EMPTY_INSTITUTION,
                cleanRecovery
              );
              return;
            }
            setAuthNotice(
              parsed.data?.message ||
                'Pendaftaran berhasil. Menunggu aktivasi oleh Administrator.'
            );
            return;
          }
          serverUnavailable = true;
        } catch (err) {
          if (!(err instanceof TypeError)) {
            throw err;
          }
          serverUnavailable = true;
        }
      }

      if (serverUnavailable) {
        const existsLocally = await hasOfflineUsername(username);
        if (existsLocally) {
          throw new Error('Nama pengguna tersebut sudah terdaftar. Gunakan nama lain.');
        }

        const hasLocalAdmin = await hasActiveOfflineAdmin();
        let assignedRole: UserRole = 'Operator';
        let assignedStatus: 'active' | 'pending' = 'pending';

        if (!hasLocalAdmin) {
          assignedRole = 'Administrator';
          assignedStatus = 'active';
        } else if (requestedRole === 'Administrator') {
          const validApprover = await verifyActiveOfflineAdmin(
            options?.approverUsername || '',
            options?.approverPassword || ''
          );
          if (!validApprover) {
            throw new Error(
              'Untuk langsung mengaktifkan akun Administrator baru, masukkan nama pengguna dan kata sandi Administrator yang sudah aktif.'
            );
          }
          assignedRole = 'Administrator';
          assignedStatus = 'active';
        }

        const now = new Date().toISOString();
        const localUid =
          assignedRole === 'Administrator' ? `local_admin_${Date.now()}` : `local_usr_${Date.now()}`;
        const localUser: AppUser = {
          uid: localUid,
          username: username.trim(),
          displayName: displayName.trim() || username.trim(),
          email: '',
          phone: '',
          position: assignedRole === 'Administrator' ? 'Administrator Sistem' : '',
          role: assignedRole,
          status: assignedStatus,
          hasRecoveryCode: Boolean(cleanRecovery && cleanRecovery.length >= 4),
          createdAt: now,
          updatedAt: now,
          createdBy: localUid,
          updatedBy: localUid,
        };
        await cacheOfflineAuthCredential(username, password, localUser, cleanRecovery);
        if (assignedStatus === 'active') {
          await applyLocalOfflineSession(localUser);
          return;
        }
        setAuthNotice(
          'Pendaftaran dicatat pada perangkat ini dengan status Menunggu Aktivasi oleh Administrator.'
        );
      }
    } catch (err) {
      if (err instanceof TypeError) {
        setAuthError('Tidak dapat terhubung ke server pendaftaran. Periksa koneksi internet Anda.');
      } else {
        setAuthError(
          extractErrorMessage(err instanceof Error ? err.message : err, 'Gagal mendaftarkan akun.')
        );
      }
    } finally {
      setSigningIn(false);
    }
  };

  const activatePendingWithAdminCredentials = async (payload: {
    username: string;
    password: string;
    approverUsername: string;
    approverPassword: string;
    promoteToAdmin: boolean;
  }) => {
    setSigningIn(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      let serverUnavailable = !navigator.onLine;
      if (navigator.onLine) {
        try {
          const res = await fetch('/api/auth/activate-pending', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              username: payload.username,
              approverUsername: payload.approverUsername,
              approverPassword: payload.approverPassword,
              promoteToAdmin: payload.promoteToAdmin,
            }),
          });
          const parsed = await parseJsonResponse<{
            ok?: boolean;
            user?: AppUser;
            error?: unknown;
          }>(res);
          const isEdgeOrProxyUnavailable =
            !parsed.isJson || res.status === 404 || res.status >= 500;
          if (!isEdgeOrProxyUnavailable) {
            if (!parsed.ok) {
              throw new Error(
                extractErrorMessage(parsed.data, 'Kredensial Administrator tidak sesuai.')
              );
            }
            if (payload.password) {
              await signInWithUsername(payload.username, payload.password);
            } else {
              setPendingStatusUser(null);
              setAuthNotice(`Akun ${payload.username} telah diaktifkan. Silakan masuk.`);
            }
            return;
          }
          serverUnavailable = true;
        } catch (err) {
          if (!(err instanceof TypeError)) {
            throw err;
          }
          serverUnavailable = true;
        }
      }

      if (serverUnavailable) {
        const validApprover = await verifyActiveOfflineAdmin(
          payload.approverUsername,
          payload.approverPassword
        );
        if (!validApprover) {
          throw new Error('Nama pengguna atau kata sandi Administrator aktif tidak sesuai.');
        }
        const localCheck = await verifyOfflineAuthCredentialDetailed(
          payload.username,
          payload.password
        );
        if (localCheck.status !== 'ok') {
          throw new Error('Akun tidak ditemukan pada penyimpanan lokal perangkat ini.');
        }
        const updated =
          (await updateOfflineAuthUserMetadata(localCheck.user.uid, {
            status: 'active',
            role: payload.promoteToAdmin ? 'Administrator' : localCheck.user.role,
            position: payload.promoteToAdmin
              ? localCheck.user.position || 'Administrator Sistem'
              : localCheck.user.position,
            updatedBy: validApprover.uid,
          })) || {
            ...localCheck.user,
            status: 'active' as const,
            role: payload.promoteToAdmin ? ('Administrator' as const) : localCheck.user.role,
          };
        await applyLocalOfflineSession(updated);
      }
    } catch (err) {
      setAuthError(
        extractErrorMessage(
          err instanceof Error ? err.message : err,
          'Gagal mengaktifkan akun.'
        )
      );
    } finally {
      setSigningIn(false);
    }
  };

  const recoverUsername = async (
    displayName: string,
    secret: string
  ): Promise<{ username: string; displayName: string; fromOffline: boolean }> => {
    setAuthError(null);
    let serverUnavailable = !navigator.onLine;

    if (navigator.onLine) {
      try {
        const res = await fetch('/api/auth/recover-username', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ displayName, secret }),
        });
        const parsed = await parseJsonResponse<{
          username?: string;
          displayName?: string;
          error?: unknown;
        }>(res);
        const isEdgeOrProxyUnavailable =
          !parsed.isJson || res.status === 404 || res.status >= 500;

        if (!isEdgeOrProxyUnavailable) {
          if (!parsed.ok || !parsed.data?.username) {
            throw new Error(
              extractErrorMessage(
                parsed.data,
                'Data nama lengkap atau kata sandi/kode pemulihan tidak cocok.'
              )
            );
          }
          return {
            username: parsed.data.username,
            displayName: parsed.data.displayName || displayName,
            fromOffline: false,
          };
        }
        serverUnavailable = true;
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw err;
        }
        serverUnavailable = true;
      }
    }

    if (serverUnavailable) {
      const localMatch = await recoverOfflineUsername(displayName, secret);
      if (localMatch) {
        return { ...localMatch, fromOffline: true };
      }
    }

    throw new Error('Data nama lengkap atau kata sandi/kode pemulihan tidak cocok.');
  };

  const resetAccountWithRecovery = async (payload: {
    identifier: string;
    recoveryCode: string;
    newUsername?: string;
    newPassword: string;
  }): Promise<{ username: string; message: string; fromOffline: boolean }> => {
    setAuthError(null);
    let serverUnavailable = !navigator.onLine;

    if (navigator.onLine) {
      try {
        const res = await fetch('/api/auth/reset-account', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const parsed = await parseJsonResponse<{
          username?: string;
          message?: string;
          error?: unknown;
        }>(res);
        const isEdgeOrProxyUnavailable =
          !parsed.isJson || res.status === 404 || res.status >= 500;

        if (!isEdgeOrProxyUnavailable) {
          if (!parsed.ok || !parsed.data?.username) {
            throw new Error(
              extractErrorMessage(parsed.data, 'Gagal mereset akun. Periksa kode pemulihan Anda.')
            );
          }
          return {
            username: parsed.data.username,
            message:
              parsed.data.message ||
              `Akun ${parsed.data.username} berhasil direset. Silakan masuk dengan kredensial baru.`,
            fromOffline: false,
          };
        }
        serverUnavailable = true;
      } catch (err) {
        if (!(err instanceof TypeError)) {
          throw err;
        }
        serverUnavailable = true;
      }
    }

    if (serverUnavailable) {
      const localResult = await resetOfflineAccount(
        payload.identifier,
        payload.recoveryCode,
        payload.newUsername || '',
        payload.newPassword
      );
      return {
        username: localResult.username,
        message: `Akun ${localResult.username} berhasil direset pada penyimpanan lokal perangkat ini. Silakan masuk dengan kredensial baru.`,
        fromOffline: true,
      };
    }

    throw new Error('Layanan reset akun tidak tersedia.');
  };

  const resetLocalOfflineAuth = async () => {
    await clearAllOfflineAuthAccounts();
    await checkBootstrapStatus();
    setAuthError(null);
    setAuthNotice(
      'Data akun lokal pada peramban ini telah direset. Anda dapat membuat ulang akun Administrator lokal atau masuk saat server terhubung.'
    );
  };

  const uploadInstitutionImage = async (
    field: 'logoUrl' | 'photoUrl',
    dataUrl: string,
    baseProfile?: InstitutionProfile
  ): Promise<{ url: string; queuedOffline: boolean }> => {
    const base = baseProfile || institution || EMPTY_INSTITUTION;
    const optimisticInst: InstitutionProfile = {
      ...base,
      [field]: dataUrl,
      createdBy: base.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || base.updatedBy || '',
    };

    setInstitution(optimisticInst);
    await setOfflineKV('institution', optimisticInst);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ url: string; institution: InstitutionProfile }>(
          '/api/institution/upload',
          {
            method: 'POST',
            body: { field, dataUrl },
          }
        );
        const mergedInst: InstitutionProfile = {
          ...optimisticInst,
          [field]: res.url,
        };
        setInstitution(mergedInst);
        await setOfflineKV('institution', mergedInst);
        return { url: res.url, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: '/api/institution',
      method: 'PUT',
      body: optimisticInst as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { url: dataUrl, queuedOffline: true };
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
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    recoveryCode?: string;
  }): Promise<{ queuedOffline: boolean }> => {
    if (!appUser) throw new Error('Pengguna tidak terautentikasi.');

    if (navigator.onLine && sessionToken) {
      const res = await apiRequest<{ user: AppUser }>('/api/auth/me', {
        method: 'PATCH',
        body: payload as unknown as Record<string, unknown>,
      });
      setAppUser(res.user);
      await updateOfflineAuthUserMetadata(
        res.user.uid,
        res.user,
        payload.newPassword || undefined,
        payload.recoveryCode || undefined
      );
      return { queuedOffline: false };
    }

    if (payload.newPassword && payload.newPassword.length > 0) {
      const verify = await verifyOfflineAuthCredentialDetailed(
        appUser.username || '',
        payload.currentPassword || ''
      );
      if (verify.status !== 'ok') {
        throw new Error('Kata sandi lama tidak sesuai.');
      }
      if (payload.newPassword.length < 6) {
        throw new Error('Kata sandi baru minimal 6 karakter.');
      }
    }

    const cleanRecovery = payload.recoveryCode?.trim() || undefined;
    if (cleanRecovery && (cleanRecovery.length < 4 || cleanRecovery.length > 64)) {
      throw new Error('Kode pemulihan harus 4 hingga 64 karakter.');
    }

    const updatedLocal: AppUser = {
      ...appUser,
      displayName: payload.displayName,
      phone: payload.phone,
      position: payload.position,
      hasRecoveryCode: Boolean(appUser.hasRecoveryCode || cleanRecovery),
    };
    await updateOfflineAuthUserMetadata(
      appUser.uid,
      updatedLocal,
      payload.newPassword || undefined,
      cleanRecovery
    );
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
        activatePendingWithAdminCredentials,
        recoverUsername,
        resetAccountWithRecovery,
        resetLocalOfflineAuth,
        signOutUser,
        apiRequest,
        uploadInstitutionImage,
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
