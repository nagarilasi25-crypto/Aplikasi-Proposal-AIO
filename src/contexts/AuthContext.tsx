import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AiNarrativeRequest,
  AiNarrativeResponse,
  AppUser,
  AuditLogRecord,
  DEFAULT_INSTITUTION_SEED,
  InstitutionProfile,
  ProposalAttachment,
  ProposalBudget,
  ProposalCategory,
  ProposalRecord,
  ProposalStatus,
  ProposalStatusHistory,
  ProposalTemplate,
  SystemAppSettings,
  UserRole,
} from '../types/models';
import {
  createInitialCategories,
  createInitialTemplates,
  DEFAULT_APP_SETTINGS,
} from '../lib/defaultSeeds';
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
  templates: ProposalTemplate[];
  budgets: ProposalBudget[];
  attachments: ProposalAttachment[];
  statusHistory: ProposalStatusHistory[];
  appSettings: SystemAppSettings;
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
  generateAiNarrative: (payload: AiNarrativeRequest) => Promise<AiNarrativeResponse>;
  saveCategory: (
    payload: Partial<ProposalCategory> & { name: string }
  ) => Promise<{ category: ProposalCategory; queuedOffline: boolean }>;
  deleteCategory: (id: string) => Promise<{ queuedOffline: boolean }>;
  saveTemplate: (
    payload: Partial<ProposalTemplate> & { name: string }
  ) => Promise<{ template: ProposalTemplate; queuedOffline: boolean }>;
  duplicateTemplate: (id: string) => Promise<{ template: ProposalTemplate; queuedOffline: boolean }>;
  deleteTemplate: (id: string) => Promise<{ queuedOffline: boolean }>;
  saveProposal: (
    payload: Partial<ProposalRecord> & { title: string }
  ) => Promise<{ proposal: ProposalRecord; queuedOffline: boolean }>;
  duplicateProposal: (id: string) => Promise<{ proposal: ProposalRecord; queuedOffline: boolean }>;
  updateProposalStatus: (
    id: string,
    payload: {
      status: ProposalStatus;
      approvedAmount?: number;
      receivedAmount?: number;
      notes?: string;
    }
  ) => Promise<{ proposal: ProposalRecord; queuedOffline: boolean }>;
  deleteProposal: (id: string) => Promise<{ queuedOffline: boolean }>;
  saveBudget: (
    payload: Partial<ProposalBudget> & { proposalId: string }
  ) => Promise<{ budget: ProposalBudget; queuedOffline: boolean }>;
  deleteBudget: (id: string) => Promise<{ queuedOffline: boolean }>;
  createAttachment: (payload: {
    proposalId?: string;
    proposalTitle?: string;
    category: ProposalAttachment['category'];
    title: string;
    description?: string;
    dataUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    isImage: boolean;
  }) => Promise<{ attachment: ProposalAttachment; queuedOffline: boolean }>;
  deleteAttachment: (id: string) => Promise<{ queuedOffline: boolean }>;
  saveAppSettings: (payload: SystemAppSettings) => Promise<{ queuedOffline: boolean }>;
  fetchAuditLogs: () => Promise<AuditLogRecord[]>;
  exportBackupSnapshot: () => Promise<Record<string, unknown>>;
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
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [budgets, setBudgets] = useState<ProposalBudget[]>([]);
  const [attachments, setAttachments] = useState<ProposalAttachment[]>([]);
  const [statusHistory, setStatusHistory] = useState<ProposalStatusHistory[]>([]);
  const [appSettings, setAppSettings] = useState<SystemAppSettings>(DEFAULT_APP_SETTINGS);

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

  const loadOfflineCollections = useCallback(async () => {
    const [
      cachedInst,
      cachedProps,
      cachedCats,
      cachedTpls,
      cachedBudgets,
      cachedAtts,
      cachedHist,
      cachedSettings,
    ] = await Promise.all([
      getOfflineKV<InstitutionProfile>('institution'),
      getOfflineKV<ProposalRecord[]>('proposals'),
      getOfflineKV<ProposalCategory[]>('categories'),
      getOfflineKV<ProposalTemplate[]>('templates'),
      getOfflineKV<ProposalBudget[]>('budgets'),
      getOfflineKV<ProposalAttachment[]>('attachments'),
      getOfflineKV<ProposalStatusHistory[]>('statusHistory'),
      getOfflineKV<SystemAppSettings>('appSettings'),
    ]);
    setInstitution(cachedInst || EMPTY_INSTITUTION);
    setProposals(cachedProps || []);
    setCategories(
      cachedCats && cachedCats.length > 0 ? cachedCats : createInitialCategories()
    );
    setTemplates(
      cachedTpls && cachedTpls.length > 0 ? cachedTpls : createInitialTemplates('system')
    );
    setBudgets(cachedBudgets || []);
    setAttachments(cachedAtts || []);
    setStatusHistory(cachedHist || []);
    setAppSettings(cachedSettings || DEFAULT_APP_SETTINGS);
  }, []);

  const refreshDashboardData = useCallback(async () => {
    setInstitutionLoading(true);
    try {
      if (isOnline && sessionToken) {
        const data = await apiRequest<{
          institution: InstitutionProfile;
          proposals: ProposalRecord[];
          categories: ProposalCategory[];
          templates?: ProposalTemplate[];
          budgets?: ProposalBudget[];
          attachments?: ProposalAttachment[];
          statusHistory?: ProposalStatusHistory[];
          appSettings?: SystemAppSettings;
        }>('/api/dashboard-data');

        // Preserve any locally queued institution draft until queue flush finishes
        const pendingQueue = await getOfflineMutationQueue();
        const hasPendingInst = pendingQueue.some((m) => m.endpoint === '/api/institution');
        const cachedInst = hasPendingInst
          ? await getOfflineKV<InstitutionProfile>('institution')
          : null;
        const effectiveInst = cachedInst || data.institution || EMPTY_INSTITUTION;
        const effectiveCats = data.categories || [];
        const effectiveTpls = data.templates || [];
        const effectiveBudgets = data.budgets || [];
        const effectiveAtts = data.attachments || [];
        const effectiveHist = data.statusHistory || [];
        const effectiveSettings = data.appSettings || DEFAULT_APP_SETTINGS;

        setInstitution(effectiveInst);
        setProposals(data.proposals || []);
        setCategories(effectiveCats);
        setTemplates(effectiveTpls);
        setBudgets(effectiveBudgets);
        setAttachments(effectiveAtts);
        setStatusHistory(effectiveHist);
        setAppSettings(effectiveSettings);

        await cacheDashboardSnapshot({
          institution: effectiveInst,
          proposals: data.proposals || [],
          categories: effectiveCats,
          templates: effectiveTpls,
          budgets: effectiveBudgets,
          attachments: effectiveAtts,
          statusHistory: effectiveHist,
          appSettings: effectiveSettings,
        });
      } else {
        await loadOfflineCollections();
      }
    } catch {
      await loadOfflineCollections();
    } finally {
      setInstitutionLoading(false);
    }
  }, [apiRequest, isOnline, loadOfflineCollections, sessionToken]);

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

  const generateAiNarrative = async (
    payload: AiNarrativeRequest
  ): Promise<AiNarrativeResponse> => {
    if (!navigator.onLine || !sessionToken) {
      throw new Error(
        'Pembuatan narasi menggunakan AI memerlukan koneksi internet dan sesi server yang aktif.'
      );
    }
    return apiRequest<AiNarrativeResponse>('/api/ai/generate-narrative', {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>,
    });
  };

  const saveCategory = async (
    payload: Partial<ProposalCategory> & { name: string }
  ): Promise<{ category: ProposalCategory; queuedOffline: boolean }> => {
    const isEdit = Boolean(payload.id && categories.some((c) => c.id === payload.id));
    const now = new Date().toISOString();
    const localCat: ProposalCategory = {
      id: payload.id || `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      institutionId: 'ar-raudhah',
      name: payload.name.trim(),
      code: (payload.code || payload.name.slice(0, 3)).toUpperCase(),
      description: payload.description || '',
      isActive: payload.isActive !== false,
      createdAt: payload.createdAt || now,
      updatedAt: now,
    };

    const nextCats = isEdit
      ? categories.map((c) => (c.id === localCat.id ? localCat : c))
      : [...categories, localCat];
    setCategories(nextCats);
    await setOfflineKV('categories', nextCats);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ category: ProposalCategory }>(
          isEdit ? `/api/categories/${localCat.id}` : '/api/categories',
          {
            method: isEdit ? 'PUT' : 'POST',
            body: localCat as unknown as Record<string, unknown>,
          }
        );
        const synced = isEdit
          ? categories.map((c) => (c.id === res.category.id ? res.category : c))
          : [...categories, res.category];
        setCategories(synced);
        await setOfflineKV('categories', synced);
        return { category: res.category, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: isEdit ? `/api/categories/${localCat.id}` : '/api/categories',
      method: isEdit ? 'PUT' : 'POST',
      body: localCat as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { category: localCat, queuedOffline: true };
  };

  const deleteCategory = async (id: string): Promise<{ queuedOffline: boolean }> => {
    const nextCats = categories.filter((c) => c.id !== id);
    setCategories(nextCats);
    await setOfflineKV('categories', nextCats);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/categories/${id}`, { method: 'DELETE' });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({ endpoint: `/api/categories/${id}`, method: 'DELETE', body: {} });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const saveTemplate = async (
    payload: Partial<ProposalTemplate> & { name: string }
  ): Promise<{ template: ProposalTemplate; queuedOffline: boolean }> => {
    const isEdit = Boolean(payload.id && templates.some((t) => t.id === payload.id));
    const now = new Date().toISOString();
    const localTpl: ProposalTemplate = {
      id: payload.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      institutionId: 'ar-raudhah',
      name: payload.name.trim(),
      proposalType: payload.proposalType || 'Umum',
      description: payload.description || '',
      sections: payload.sections || [],
      isDefault: Boolean(payload.isDefault),
      isActive: payload.isActive !== false,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      createdBy: payload.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };

    const nextTpls = isEdit
      ? templates.map((t) => (t.id === localTpl.id ? localTpl : t))
      : [...templates, localTpl];
    setTemplates(nextTpls);
    await setOfflineKV('templates', nextTpls);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ template: ProposalTemplate }>(
          isEdit ? `/api/templates/${localTpl.id}` : '/api/templates',
          {
            method: isEdit ? 'PUT' : 'POST',
            body: localTpl as unknown as Record<string, unknown>,
          }
        );
        const synced = isEdit
          ? templates.map((t) => (t.id === res.template.id ? res.template : t))
          : [...templates, res.template];
        setTemplates(synced);
        await setOfflineKV('templates', synced);
        return { template: res.template, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: isEdit ? `/api/templates/${localTpl.id}` : '/api/templates',
      method: isEdit ? 'PUT' : 'POST',
      body: localTpl as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { template: localTpl, queuedOffline: true };
  };

  const duplicateTemplate = async (
    id: string
  ): Promise<{ template: ProposalTemplate; queuedOffline: boolean }> => {
    const src = templates.find((t) => t.id === id);
    if (!src) throw new Error('Template sumber tidak ditemukan.');

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ template: ProposalTemplate }>(
          `/api/templates/${id}/duplicate`,
          { method: 'POST', body: {} }
        );
        const nextTpls = [...templates, res.template];
        setTemplates(nextTpls);
        await setOfflineKV('templates', nextTpls);
        return { template: res.template, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    const now = new Date().toISOString();
    const copy: ProposalTemplate = {
      ...src,
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${src.name} (Salinan)`,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      createdBy: appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };
    return saveTemplate(copy);
  };

  const deleteTemplate = async (id: string): Promise<{ queuedOffline: boolean }> => {
    const nextTpls = templates.filter((t) => t.id !== id);
    setTemplates(nextTpls);
    await setOfflineKV('templates', nextTpls);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/templates/${id}`, { method: 'DELETE' });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({ endpoint: `/api/templates/${id}`, method: 'DELETE', body: {} });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const saveProposal = async (
    payload: Partial<ProposalRecord> & { title: string }
  ): Promise<{ proposal: ProposalRecord; queuedOffline: boolean }> => {
    const isEdit = Boolean(payload.id && proposals.some((p) => p.id === payload.id));
    const existing = isEdit ? proposals.find((p) => p.id === payload.id) : undefined;
    const now = new Date().toISOString();
    const localId = payload.id || `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const linkedBudget = budgets.find((b) => b.proposalId === localId);
    const localProposal: ProposalRecord = {
      id: localId,
      institutionId: 'ar-raudhah',
      proposalNumber: payload.proposalNumber ?? existing?.proposalNumber ?? '',
      proposalDate: payload.proposalDate ?? existing?.proposalDate ?? now.slice(0, 10),
      fiscalYear: payload.fiscalYear ?? existing?.fiscalYear ?? appSettings.defaultFiscalYear,
      title: payload.title.trim(),
      categoryId: payload.categoryId ?? existing?.categoryId ?? '',
      categoryName: payload.categoryName ?? existing?.categoryName ?? '',
      templateId: payload.templateId ?? existing?.templateId ?? '',
      proposalType: payload.proposalType ?? existing?.proposalType ?? '',
      recipientName: payload.recipientName ?? existing?.recipientName ?? '',
      recipientInstitution: payload.recipientInstitution ?? existing?.recipientInstitution ?? '',
      recipientAddress: payload.recipientAddress ?? existing?.recipientAddress ?? '',
      location: payload.location ?? existing?.location ?? '',
      executionTime: payload.executionTime ?? existing?.executionTime ?? '',
      summary: payload.summary ?? existing?.summary ?? '',
      sections: payload.sections ?? existing?.sections ?? [],
      attachmentIds: payload.attachmentIds ?? existing?.attachmentIds ?? [],
      isArchived: payload.isArchived ?? existing?.isArchived ?? false,
      archivedAt: payload.isArchived ? existing?.archivedAt || now : '',
      status: payload.status ?? existing?.status ?? 'Draft',
      totalBudget: linkedBudget ? linkedBudget.totalAmount : payload.totalBudget ?? existing?.totalBudget ?? 0,
      approvedAmount: payload.approvedAmount ?? existing?.approvedAmount ?? 0,
      receivedAmount: payload.receivedAmount ?? existing?.receivedAmount ?? 0,
      submittedAt: payload.submittedAt ?? existing?.submittedAt ?? '',
      approvedAt: payload.approvedAt ?? existing?.approvedAt ?? '',
      rejectedReason: payload.rejectedReason ?? existing?.rejectedReason ?? '',
      followUpNotes: payload.followUpNotes ?? existing?.followUpNotes ?? '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      createdBy: existing?.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };

    const nextProps = isEdit
      ? proposals.map((p) => (p.id === localId ? localProposal : p))
      : [localProposal, ...proposals];
    setProposals(nextProps);
    await setOfflineKV('proposals', nextProps);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ proposal: ProposalRecord }>(
          isEdit ? `/api/proposals/${localId}` : '/api/proposals',
          {
            method: isEdit ? 'PUT' : 'POST',
            body: localProposal as unknown as Record<string, unknown>,
          }
        );
        const synced = isEdit
          ? proposals.map((p) => (p.id === res.proposal.id ? res.proposal : p))
          : [res.proposal, ...proposals];
        setProposals(synced);
        await setOfflineKV('proposals', synced);
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: isEdit ? `/api/proposals/${localId}` : '/api/proposals',
      method: isEdit ? 'PUT' : 'POST',
      body: localProposal as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { proposal: localProposal, queuedOffline: true };
  };

  const duplicateProposal = async (
    id: string
  ): Promise<{ proposal: ProposalRecord; queuedOffline: boolean }> => {
    const src = proposals.find((p) => p.id === id);
    if (!src) throw new Error('Proposal sumber tidak ditemukan.');

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ proposal: ProposalRecord }>(
          `/api/proposals/${id}/duplicate`,
          { method: 'POST', body: {} }
        );
        await refreshDashboardData();
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    const now = new Date().toISOString();
    const copy: ProposalRecord = {
      ...src,
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      proposalNumber: '',
      proposalDate: now.slice(0, 10),
      title: `${src.title} (Salinan)`,
      status: 'Draft',
      approvedAmount: 0,
      receivedAmount: 0,
      submittedAt: '',
      approvedAt: '',
      rejectedReason: '',
      isArchived: false,
      archivedAt: '',
      createdAt: now,
      updatedAt: now,
      createdBy: appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };
    return saveProposal(copy);
  };

  const updateProposalStatus = async (
    id: string,
    payload: {
      status: ProposalStatus;
      approvedAmount?: number;
      receivedAmount?: number;
      notes?: string;
    }
  ): Promise<{ proposal: ProposalRecord; queuedOffline: boolean }> => {
    const target = proposals.find((p) => p.id === id);
    if (!target) throw new Error('Proposal tidak ditemukan.');

    const now = new Date().toISOString();
    const updatedLocal: ProposalRecord = {
      ...target,
      status: payload.status,
      approvedAmount: payload.approvedAmount ?? target.approvedAmount ?? 0,
      receivedAmount: payload.receivedAmount ?? target.receivedAmount ?? 0,
      followUpNotes: payload.notes ?? target.followUpNotes,
      submittedAt:
        payload.status === 'Sudah diajukan' ? target.submittedAt || now : target.submittedAt,
      approvedAt: payload.status === 'Disetujui' ? now : target.approvedAt,
      updatedAt: now,
      updatedBy: appUser?.uid || '',
    };

    const nextProps = proposals.map((p) => (p.id === id ? updatedLocal : p));
    setProposals(nextProps);
    await setOfflineKV('proposals', nextProps);

    const localHist: ProposalStatusHistory = {
      id: `hist_${Date.now()}`,
      institutionId: 'ar-raudhah',
      proposalId: id,
      proposalTitle: target.title,
      fromStatus: target.status,
      toStatus: payload.status,
      approvedAmount: payload.approvedAmount,
      receivedAmount: payload.receivedAmount,
      notes: payload.notes,
      actorUid: appUser?.uid || '',
      actorName: appUser?.displayName || appUser?.username || 'Pengguna',
      createdAt: now,
    };
    const nextHist = [localHist, ...statusHistory];
    setStatusHistory(nextHist);
    await setOfflineKV('statusHistory', nextHist);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{
          proposal: ProposalRecord;
          historyEntry: ProposalStatusHistory;
        }>(`/api/proposals/${id}/status`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        });
        const syncedProps = proposals.map((p) => (p.id === id ? res.proposal : p));
        setProposals(syncedProps);
        await setOfflineKV('proposals', syncedProps);
        const syncedHist = [res.historyEntry, ...statusHistory];
        setStatusHistory(syncedHist);
        await setOfflineKV('statusHistory', syncedHist);
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: `/api/proposals/${id}/status`,
      method: 'PATCH',
      body: payload as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { proposal: updatedLocal, queuedOffline: true };
  };

  const deleteProposal = async (id: string): Promise<{ queuedOffline: boolean }> => {
    const nextProps = proposals.filter((p) => p.id !== id);
    const nextBudgets = budgets.filter((b) => b.proposalId !== id);
    setProposals(nextProps);
    setBudgets(nextBudgets);
    await setOfflineKV('proposals', nextProps);
    await setOfflineKV('budgets', nextBudgets);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/proposals/${id}`, { method: 'DELETE' });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({ endpoint: `/api/proposals/${id}`, method: 'DELETE', body: {} });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const saveBudget = async (
    payload: Partial<ProposalBudget> & { proposalId: string }
  ): Promise<{ budget: ProposalBudget; queuedOffline: boolean }> => {
    const now = new Date().toISOString();
    const linkedProp = proposals.find((p) => p.id === payload.proposalId);
    const existing = budgets.find((b) => b.proposalId === payload.proposalId);
    const normalizedItems = (payload.items || []).map((it, idx) => {
      const vol = Number(it.volume) || 0;
      const price = Number(it.unitPrice) || 0;
      return {
        ...it,
        order: idx + 1,
        volume: vol,
        unitPrice: price,
        totalPrice: Math.round(vol * price),
      };
    });
    const totalAmount = normalizedItems.reduce((sum, it) => sum + it.totalPrice, 0);

    const localBudget: ProposalBudget = {
      id: existing?.id || payload.id || `rab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      institutionId: 'ar-raudhah',
      proposalId: payload.proposalId,
      proposalTitle: linkedProp?.title || payload.proposalTitle || '',
      title: payload.title || `RAB - ${linkedProp?.title || 'Proposal'}`,
      notes: payload.notes || '',
      items: normalizedItems,
      totalAmount,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      createdBy: existing?.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };

    const nextBudgets = existing
      ? budgets.map((b) => (b.id === localBudget.id ? localBudget : b))
      : [localBudget, ...budgets];
    setBudgets(nextBudgets);
    await setOfflineKV('budgets', nextBudgets);

    const nextProps = proposals.map((p) =>
      p.id === payload.proposalId ? { ...p, totalBudget: totalAmount, updatedAt: now } : p
    );
    setProposals(nextProps);
    await setOfflineKV('proposals', nextProps);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ budget: ProposalBudget }>('/api/budgets', {
          method: 'POST',
          body: localBudget as unknown as Record<string, unknown>,
        });
        const syncedBudgets = existing
          ? budgets.map((b) => (b.id === res.budget.id ? res.budget : b))
          : [res.budget, ...budgets];
        setBudgets(syncedBudgets);
        await setOfflineKV('budgets', syncedBudgets);
        const syncedProps = proposals.map((p) =>
          p.id === payload.proposalId ? { ...p, totalBudget: res.budget.totalAmount } : p
        );
        setProposals(syncedProps);
        await setOfflineKV('proposals', syncedProps);
        return { budget: res.budget, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: '/api/budgets',
      method: 'POST',
      body: localBudget as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { budget: localBudget, queuedOffline: true };
  };

  const deleteBudget = async (id: string): Promise<{ queuedOffline: boolean }> => {
    const target = budgets.find((b) => b.id === id);
    const nextBudgets = budgets.filter((b) => b.id !== id);
    setBudgets(nextBudgets);
    await setOfflineKV('budgets', nextBudgets);
    if (target) {
      const nextProps = proposals.map((p) =>
        p.id === target.proposalId ? { ...p, totalBudget: 0 } : p
      );
      setProposals(nextProps);
      await setOfflineKV('proposals', nextProps);
    }

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/budgets/${id}`, { method: 'DELETE' });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({ endpoint: `/api/budgets/${id}`, method: 'DELETE', body: {} });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const createAttachment = async (payload: {
    proposalId?: string;
    proposalTitle?: string;
    category: ProposalAttachment['category'];
    title: string;
    description?: string;
    dataUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    isImage: boolean;
  }): Promise<{ attachment: ProposalAttachment; queuedOffline: boolean }> => {
    const now = new Date().toISOString();
    const attId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const localAtt: ProposalAttachment = {
      id: attId,
      institutionId: 'ar-raudhah',
      proposalId: payload.proposalId || '',
      proposalTitle: payload.proposalTitle || '',
      category: payload.category,
      title: payload.title.trim(),
      description: payload.description || '',
      fileUrl: payload.dataUrl,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      isImage: payload.isImage,
      createdAt: now,
      updatedAt: now,
      createdBy: appUser?.uid || '',
    };

    const nextAtts = [localAtt, ...attachments];
    setAttachments(nextAtts);
    await setOfflineKV('attachments', nextAtts);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ attachment: ProposalAttachment }>('/api/attachments', {
          method: 'POST',
          body: {
            id: attId,
            proposalId: payload.proposalId || '',
            proposalTitle: payload.proposalTitle || '',
            category: payload.category,
            title: payload.title.trim(),
            description: payload.description || '',
            dataUrl: payload.dataUrl,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
            fileSize: payload.fileSize,
            isImage: payload.isImage,
          },
        });
        const synced = [res.attachment, ...attachments];
        setAttachments(synced);
        await setOfflineKV('attachments', synced);
        return { attachment: res.attachment, queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: '/api/attachments',
      method: 'POST',
      body: {
        id: attId,
        proposalId: payload.proposalId || '',
        proposalTitle: payload.proposalTitle || '',
        category: payload.category,
        title: payload.title.trim(),
        description: payload.description || '',
        dataUrl: payload.dataUrl,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        fileSize: payload.fileSize,
        isImage: payload.isImage,
      },
    });
    await refreshQueueCount();
    return { attachment: localAtt, queuedOffline: true };
  };

  const deleteAttachment = async (id: string): Promise<{ queuedOffline: boolean }> => {
    const nextAtts = attachments.filter((a) => a.id !== id);
    setAttachments(nextAtts);
    await setOfflineKV('attachments', nextAtts);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/attachments/${id}`, { method: 'DELETE' });
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({ endpoint: `/api/attachments/${id}`, method: 'DELETE', body: {} });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const saveAppSettings = async (
    payload: SystemAppSettings
  ): Promise<{ queuedOffline: boolean }> => {
    setAppSettings(payload);
    await setOfflineKV('appSettings', payload);

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ appSettings: SystemAppSettings }>('/api/settings/app', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
        setAppSettings(res.appSettings);
        await setOfflineKV('appSettings', res.appSettings);
        return { queuedOffline: false };
      } catch (err) {
        if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
          throw err;
        }
      }
    }

    await enqueueOfflineMutation({
      endpoint: '/api/settings/app',
      method: 'PUT',
      body: payload as unknown as Record<string, unknown>,
    });
    await refreshQueueCount();
    return { queuedOffline: true };
  };

  const fetchAuditLogs = async (): Promise<AuditLogRecord[]> => {
    if (!navigator.onLine || !sessionToken) {
      return [];
    }
    const res = await apiRequest<{ auditLogs: AuditLogRecord[] }>('/api/audit-logs');
    return res.auditLogs || [];
  };

  const exportBackupSnapshot = async (): Promise<Record<string, unknown>> => {
    if (navigator.onLine && sessionToken) {
      return apiRequest<Record<string, unknown>>('/api/backup/export');
    }
    return {
      exportedAt: new Date().toISOString(),
      institution,
      appSettings,
      proposalCategories: categories,
      proposalTemplates: templates,
      proposals,
      proposalBudgets: budgets,
      proposalAttachments: attachments,
      proposalStatusHistory: statusHistory,
    };
  };

  const signOutUser = () => {
    setSessionToken(null);
    setAppUser(null);
    setInstitution(null);
    setProposals([]);
    setCategories([]);
    setTemplates([]);
    setBudgets([]);
    setAttachments([]);
    setStatusHistory([]);
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
        templates,
        budgets,
        attachments,
        statusHistory,
        appSettings,
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
        generateAiNarrative,
        saveCategory,
        deleteCategory,
        saveTemplate,
        duplicateTemplate,
        deleteTemplate,
        saveProposal,
        duplicateProposal,
        updateProposalStatus,
        deleteProposal,
        saveBudget,
        deleteBudget,
        createAttachment,
        deleteAttachment,
        saveAppSettings,
        fetchAuditLogs,
        exportBackupSnapshot,
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
