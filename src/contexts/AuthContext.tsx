import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  AiNarrativeRequest,
  AiNarrativeResponse,
  AppUser,
  AuditLogRecord,
  DEFAULT_INSTITUTION_SEED,
  INSTITUTION_DOC_ID,
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
  clearFirestoreSyncQueue,
  clearOfflineMutationQueue,
  describeOfflineMutation,
  enqueueOfflineMutation,
  FirestoreSyncItem,
  getAllOfflineUsers,
  getFirestoreSyncQueue,
  getOfflineKV,
  getOfflineMutationQueue,
  hasActiveOfflineAdmin,
  hasOfflineUsername,
  OfflineSyncMutation,
  recoverOfflineUsername,
  removeOfflineMutation,
  resetFailedFirestoreItems,
  resetOfflineAccount,
  setOfflineKV,
  SyncItemReport,
  updateOfflineAuthUserMetadata,
  updateOfflineMutationStatus,
  verifyActiveOfflineAdmin,
  verifyOfflineAuthCredentialDetailed,
} from '../lib/offlineDb';
import { auth, testConnection } from '../lib/firebase';
import {
  buildArchiveFirestorePayload,
  buildAttachmentFirestorePayload,
  buildBudgetFirestorePayload,
  buildCategoryFirestorePayload,
  buildInstitutionFirestorePayload,
  buildProposalFirestorePayload,
  buildStatusHistoryFirestorePayload,
  buildTemplateFirestorePayload,
  enqueueEntityToFirestore,
  enqueueFullSnapshotToFirestore,
  enqueueSyncMutationsToFirestore,
  processFirestoreSyncQueue,
  pullSnapshotFromFirestore,
  signInFirebaseWithGoogle,
  signOutFirebase,
} from '../lib/firestoreSync';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const SESSION_STORAGE_KEY = 'arraudhah_session_v1';

interface StoredSessionData {
  token: string | null;
  user: AppUser;
  isOfflineSession?: boolean;
  savedAt?: string;
}

function isValidStoredSessionPayload(parsed: unknown): parsed is StoredSessionData {
  if (!parsed || typeof parsed !== 'object') return false;
  const candidate = parsed as Partial<StoredSessionData>;
  const validToken = candidate.token === null || typeof candidate.token === 'string';
  return Boolean(
    validToken &&
      candidate.user &&
      typeof candidate.user.uid === 'string' &&
      candidate.user.uid.length > 0 &&
      candidate.user.status === 'active'
  );
}

function saveStoredSession(
  token: string | null,
  user: AppUser,
  isOfflineSession = !token
) {
  const payload: StoredSessionData = {
    token,
    user,
    isOfflineSession,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
  void setOfflineKV('activeSession', payload);
  void setOfflineKV('swSyncToken', token);
}

function readStoredSession(): StoredSessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidStoredSessionPayload(parsed)) {
      return {
        token: parsed.token || null,
        user: parsed.user,
        isOfflineSession: Boolean(parsed.isOfflineSession || !parsed.token),
        savedAt: parsed.savedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function readStoredSessionAsync(): Promise<StoredSessionData | null> {
  const fromLocal = readStoredSession();
  if (fromLocal) {
    return fromLocal;
  }
  try {
    const fromIdb = await getOfflineKV<StoredSessionData>('activeSession');
    if (isValidStoredSessionPayload(fromIdb)) {
      const normalized: StoredSessionData = {
        token: fromIdb.token || null,
        user: fromIdb.user,
        isOfflineSession: Boolean(fromIdb.isOfflineSession || !fromIdb.token),
        savedAt: fromIdb.savedAt,
      };
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // Ignore storage quota errors
      }
      return normalized;
    }
  } catch {
    // Ignore IndexedDB read errors
  }
  return null;
}

function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore
  }
  void setOfflineKV('activeSession', null);
  void setOfflineKV('swSyncToken', null);
}

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

class AuthSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthSessionError';
  }
}

class HttpClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpClientError';
    this.status = status;
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
  serverApiAvailable: boolean;
  hasServerSession: boolean;
  pendingSyncCount: number;
  pendingSyncItems: OfflineSyncMutation[];
  syncing: boolean;
  lastSyncError: string | null;
  lastSyncReport: SyncItemReport[];
  reconnectModalOpen: boolean;
  openReconnectModal: () => void;
  closeReconnectModal: () => void;
  syncNow: () => Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
  clearPendingQueue: () => Promise<void>;
  reconnectServerSession: (
    password: string,
    options?: { approverUsername?: string; approverPassword?: string }
  ) => Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
  firebaseUser: FirebaseUser | null;
  firestoreConnected: boolean;
  firestoreQueue: FirestoreSyncItem[];
  pendingFirestoreCount: number;
  firestoreSyncing: boolean;
  lastFirestoreSyncError: string | null;
  lastFirestoreSyncReport: SyncItemReport[];
  cloudSyncModalOpen: boolean;
  openCloudSyncModal: () => void;
  closeCloudSyncModal: () => void;
  connectFirestoreCloud: () => Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
  disconnectFirestoreCloud: () => Promise<void>;
  syncFirestoreNow: () => Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
  pullFromFirestore: () => Promise<{
    counts: {
      institutions: number;
      categories: number;
      templates: number;
      proposals: number;
      budgets: number;
      attachments: number;
      archives: number;
      statusHistory: number;
    };
  }>;
  pushAllLocalToFirestore: () => Promise<{
    enqueuedCount: number;
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
  clearFirestoreQueue: () => Promise<void>;
  retryFailedFirestoreSync: () => Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }>;
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
  const [serverApiAvailable, setServerApiAvailable] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [pendingSyncItems, setPendingSyncItems] = useState<OfflineSyncMutation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [lastSyncReport, setLastSyncReport] = useState<SyncItemReport[]>([]);
  const [reconnectModalOpen, setReconnectModalOpen] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firestoreQueue, setFirestoreQueue] = useState<FirestoreSyncItem[]>([]);
  const [firestoreSyncing, setFirestoreSyncing] = useState(false);
  const [lastFirestoreSyncError, setLastFirestoreSyncError] = useState<string | null>(null);
  const [lastFirestoreSyncReport, setLastFirestoreSyncReport] = useState<SyncItemReport[]>([]);
  const [cloudSyncModalOpen, setCloudSyncModalOpen] = useState(false);
  const [pendingStatusUser, setPendingStatusUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const syncInFlightRef = useRef(false);

  const firestoreConnected = Boolean(firebaseUser && firebaseUser.emailVerified);
  const pendingFirestoreCount = firestoreQueue.length;

  const refreshQueueCount = useCallback(async () => {
    const [queue, fsQueue] = await Promise.all([
      getOfflineMutationQueue(),
      getFirestoreSyncQueue(),
    ]);
    setPendingSyncCount(queue.length);
    setPendingSyncItems(queue);
    setFirestoreQueue(fsQueue);
  }, []);

  const checkBootstrapStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const stored = await readStoredSessionAsync();
      let serverReachable = false;

      if (navigator.onLine) {
        try {
          const bootRes = await fetch('/api/auth/bootstrap-status', {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          const parsed = await parseJsonResponse<{
            needsSetup?: boolean;
            hasEnvAdminPasscode?: boolean;
          }>(bootRes);
          if (parsed.ok && parsed.isJson && typeof parsed.data?.needsSetup === 'boolean') {
            serverReachable = true;
            setNeedsSetup(parsed.data.needsSetup);
            setHasEnvAdminPasscode(Boolean(parsed.data.hasEnvAdminPasscode));
          }
        } catch {
          serverReachable = false;
        }
        setServerApiAvailable(serverReachable);
      }

      if (!serverReachable) {
        const hasLocalAdmin = await hasActiveOfflineAdmin();
        setNeedsSetup(!hasLocalAdmin);
        setHasEnvAdminPasscode(false);
      }

      if (stored && stored.user) {
        const resolveRestoredUser = async (): Promise<AppUser | null> => {
          try {
            const cachedUsers = await getAllOfflineUsers();
            const offlineMatch = cachedUsers.find(
              (u) =>
                u.status === 'active' &&
                (u.uid === stored.user.uid ||
                  (u.username || '').toLowerCase() ===
                    (stored.user.username || '').toLowerCase())
            );
            if (offlineMatch) return offlineMatch;
          } catch {
            // Fall back to stored user object
          }
          return stored.user.status === 'active' ? stored.user : null;
        };

        if (stored.token && serverReachable) {
          try {
            const meRes = await fetch('/api/auth/me', {
              cache: 'no-store',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${stored.token}`,
              },
            });
            const meParsed = await parseJsonResponse<{
              code?: string;
              user?: AppUser;
              institution?: InstitutionProfile;
            }>(meRes);

            if (meParsed.ok && meParsed.data?.user) {
              if (meParsed.data.user.status !== 'active') {
                clearStoredSession();
                setSessionToken(null);
                setAppUser(null);
                setPendingStatusUser(meParsed.data.user);
                return;
              }
              setSessionToken(stored.token);
              setAppUser(meParsed.data.user);
              setInstitution(meParsed.data.institution || EMPTY_INSTITUTION);
              setIsOfflineSession(false);
              setNeedsSetup(false);
              saveStoredSession(stored.token, meParsed.data.user, false);
              return;
            }

            if (meRes.status === 403) {
              clearStoredSession();
              setSessionToken(null);
              setAppUser(null);
              if (
                meParsed.data?.code === 'ACCOUNT_PENDING' ||
                meParsed.data?.code === 'ACCOUNT_INACTIVE'
              ) {
                setPendingStatusUser({
                  ...stored.user,
                  status: meParsed.data.code === 'ACCOUNT_PENDING' ? 'pending' : 'inactive',
                });
              }
              return;
            }

            // 401 (expired token or local-only user) or transient 404/5xx/non-JSON:
            // Preserve active login state across page refreshes in offline/cached mode.
            const restoredUser = await resolveRestoredUser();
            if (restoredUser) {
              const nextToken = meRes.status === 401 ? null : stored.token;
              setSessionToken(nextToken);
              setAppUser(restoredUser);
              setIsOfflineSession(true);
              setNeedsSetup(false);
              saveStoredSession(nextToken, restoredUser, true);
              return;
            }
            clearStoredSession();
          } catch {
            const restoredUser = await resolveRestoredUser();
            if (restoredUser) {
              setSessionToken(stored.token);
              setAppUser(restoredUser);
              setIsOfflineSession(true);
              setNeedsSetup(false);
              saveStoredSession(stored.token, restoredUser, true);
            }
          }
        } else {
          const restoredUser = await resolveRestoredUser();
          if (restoredUser) {
            const preservedToken = stored.token || null;
            setSessionToken(preservedToken);
            setAppUser(restoredUser);
            setIsOfflineSession(true);
            setNeedsSetup(false);
            saveStoredSession(preservedToken, restoredUser, true);
          }
        }
      }
    } finally {
      await refreshQueueCount();
      setAuthLoading(false);
    }
  }, [refreshQueueCount]);

  useEffect(() => {
    checkBootstrapStatus();
  }, [checkBootstrapStatus]);

  // Automatically restore online session state if user refreshed offline with a valid token
  useEffect(() => {
    if (!isOnline || !isOfflineSession || !sessionToken || !appUser) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
        });
        const parsed = await parseJsonResponse<{
          code?: string;
          user?: AppUser;
          institution?: InstitutionProfile;
        }>(res);
        if (cancelled) return;
        if (parsed.ok && parsed.data?.user && parsed.data.user.status === 'active') {
          setAppUser(parsed.data.user);
          if (parsed.data.institution) {
            setInstitution(parsed.data.institution);
          }
          setIsOfflineSession(false);
          saveStoredSession(sessionToken, parsed.data.user, false);
        } else if (res.status === 401) {
          saveStoredSession(null, appUser, true);
          setSessionToken(null);
        } else if (res.status === 403) {
          clearStoredSession();
          setSessionToken(null);
          setAppUser(null);
        }
      } catch {
        // Keep current cached/offline session
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appUser, isOfflineSession, isOnline, sessionToken]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void testConnection();
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  const apiRequest = useCallback(
    async <T = unknown,>(
      url: string,
      options?: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: Record<string, unknown>;
        tokenOverride?: string;
      }
    ): Promise<T> => {
      const effectiveToken = options?.tokenOverride ?? sessionToken;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (effectiveToken) {
        headers.Authorization = `Bearer ${effectiveToken}`;
      }

      const res = await fetch(url, {
        method: options?.method || 'GET',
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      const parsed = await parseJsonResponse<T & { error?: unknown }>(res);
      const rawErrText = extractErrorMessage(parsed.data, '');
      const isProxyNotFound =
        res.status === 404 && rawErrText.toLowerCase().includes('page could not be found');
      if (!parsed.isJson || res.status >= 500 || isProxyNotFound) {
        throw new RecoverableTransportError(
          isProxyNotFound
            ? 'Layanan server backend (/api) tidak tersedia pada alamat pratinjau ini.'
            : extractErrorMessage(
                parsed.data,
                'Layanan server tidak merespons dengan benar. Coba beberapa saat lagi.'
              )
        );
      }
      if (res.status === 401) {
        throw new AuthSessionError(
          extractErrorMessage(parsed.data, 'Sesi server kedaluwarsa. Silakan hubungkan kembali.')
        );
      }
      if (!parsed.ok) {
        throw new HttpClientError(
          extractErrorMessage(parsed.data, 'Permintaan gagal diproses.'),
          res.status
        );
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

  const downgradeToOfflineSession = useCallback(() => {
    const activeUser = appUser || readStoredSession()?.user || null;
    if (activeUser && activeUser.status === 'active') {
      saveStoredSession(null, activeUser, true);
    } else {
      clearStoredSession();
    }
    setSessionToken(null);
    setIsOfflineSession(true);
  }, [appUser]);

  const refreshDashboardData = useCallback(
    async (tokenOverride?: string) => {
      const activeToken = tokenOverride ?? sessionToken;
      setInstitutionLoading(true);
      try {
        if (navigator.onLine && activeToken) {
          const data = await apiRequest<{
            institution: InstitutionProfile;
            proposals: ProposalRecord[];
            categories: ProposalCategory[];
            templates?: ProposalTemplate[];
            budgets?: ProposalBudget[];
            attachments?: ProposalAttachment[];
            statusHistory?: ProposalStatusHistory[];
            appSettings?: SystemAppSettings;
          }>('/api/dashboard-data', { tokenOverride: activeToken });

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
    },
    [apiRequest, loadOfflineCollections, sessionToken]
  );

  const flushQueueWithToken = useCallback(
    async (
      tokenToUse: string
    ): Promise<{
      syncedCount: number;
      failedCount: number;
      lastError: string | null;
      items: SyncItemReport[];
    }> => {
      if (syncInFlightRef.current) {
        return { syncedCount: 0, failedCount: 0, lastError: null, items: [] };
      }
      const rawQueue = await getOfflineMutationQueue();
      if (rawQueue.length === 0) {
        setLastSyncError(null);
        return { syncedCount: 0, failedCount: 0, lastError: null, items: [] };
      }

      syncInFlightRef.current = true;
      setSyncing(true);
      setLastSyncError(null);

      const queue = [...rawQueue].sort((a, b) =>
        (a.createdAt || '').localeCompare(b.createdAt || '')
      );
      let syncedCount = 0;
      let failedCount = 0;
      let lastError: string | null = null;
      const itemReports: SyncItemReport[] = [];

      try {
        for (const item of queue) {
          const label = describeOfflineMutation(item);
          try {
            await apiRequest(item.endpoint, {
              method: item.method,
              body: item.body,
              tokenOverride: tokenToUse,
            });
            await removeOfflineMutation(item.id);
            syncedCount += 1;
            itemReports.push({
              id: item.id,
              label,
              target: 'server',
              status: 'synced',
            });
          } catch (err) {
            if (err instanceof AuthSessionError) {
              downgradeToOfflineSession();
              lastError = 'Sesi server kedaluwarsa. Masukkan kata sandi untuk menyambung kembali.';
              setLastSyncError(lastError);
              await updateOfflineMutationStatus(item.id, {
                retryCount: (item.retryCount || 0) + 1,
                lastError,
              });
              itemReports.push({
                id: item.id,
                label,
                target: 'server',
                status: 'failed',
                error: lastError,
              });
              break;
            }
            if (err instanceof TypeError || err instanceof RecoverableTransportError) {
              lastError = 'Server belum merespons saat menyinkronkan.';
              setLastSyncError(lastError);
              await updateOfflineMutationStatus(item.id, {
                retryCount: (item.retryCount || 0) + 1,
                lastError,
              });
              itemReports.push({
                id: item.id,
                label,
                target: 'server',
                status: 'failed',
                error: lastError,
              });
              break;
            }
            if (err instanceof HttpClientError && err.status === 404 && item.method === 'DELETE') {
              await removeOfflineMutation(item.id);
              syncedCount += 1;
              itemReports.push({
                id: item.id,
                label,
                target: 'server',
                status: 'synced',
              });
              continue;
            }
            failedCount += 1;
            lastError =
              err instanceof Error ? err.message : 'Sebagian perubahan gagal disinkronkan.';
            setLastSyncError(lastError);
            await updateOfflineMutationStatus(item.id, {
              retryCount: (item.retryCount || 0) + 1,
              lastError,
            });
            itemReports.push({
              id: item.id,
              label,
              target: 'server',
              status: 'failed',
              error: lastError,
            });
          }
        }
      } finally {
        setLastSyncReport(itemReports);
        await refreshQueueCount();
        setSyncing(false);
        syncInFlightRef.current = false;
      }

      if (syncedCount > 0) {
        await refreshDashboardData(tokenToUse);
      }

      return { syncedCount, failedCount, lastError, items: itemReports };
    },
    [apiRequest, downgradeToOfflineSession, refreshDashboardData, refreshQueueCount]
  );

  const rescueApiQueueToFirestore = useCallback(async (): Promise<SyncItemReport[]> => {
    const existingApi = await getOfflineMutationQueue();
    if (existingApi.length === 0) return [];
    const { skippedReports } = await enqueueSyncMutationsToFirestore(existingApi, {
      institution,
      categories,
      templates,
      proposals,
      budgets,
      attachments,
    });
    await refreshQueueCount();
    return skippedReports;
  }, [attachments, budgets, categories, institution, proposals, refreshQueueCount, templates]);

  const flushFirestoreNow = useCallback(async (): Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items: SyncItemReport[];
  }> => {
    setFirestoreSyncing(true);
    try {
      const skippedFromApi = await rescueApiQueueToFirestore();
      const res = await processFirestoreSyncQueue({
        institutionFallback: institution,
        onQueueChange: setFirestoreQueue,
      });
      const combinedItems = [...res.items, ...skippedFromApi];
      setLastFirestoreSyncError(res.lastError);
      setLastFirestoreSyncReport(combinedItems);

      if (res.failedCount === 0 && !serverApiAvailable) {
        const remainingApi = await getOfflineMutationQueue();
        const skippedIds = new Set(skippedFromApi.map((s) => s.id));
        for (const item of remainingApi) {
          if (!skippedIds.has(item.id)) {
            await removeOfflineMutation(item.id);
          }
        }
        setLastSyncError(null);
        await refreshQueueCount();
      }
      return {
        ...res,
        items: combinedItems,
      };
    } finally {
      setFirestoreQueue(await getFirestoreSyncQueue());
      setFirestoreSyncing(false);
    }
  }, [institution, refreshQueueCount, rescueApiQueueToFirestore, serverApiAvailable]);

  // Flush queued offline mutations automatically when internet & session token are available
  useEffect(() => {
    if (!isOnline || !sessionToken || !appUser) return;
    flushQueueWithToken(sessionToken);
  }, [isOnline, sessionToken, appUser, flushQueueWithToken]);

  // Flush queued Firestore changes automatically whenever online & Firebase Auth is active
  useEffect(() => {
    if (!isOnline || !firestoreConnected || !appUser) return;
    void flushFirestoreNow();
  }, [isOnline, firestoreConnected, appUser, flushFirestoreNow]);

  // Listen to Service Worker background sync triggers & tab visibility/online transitions
  useEffect(() => {
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC_TRIGGER') {
        void refreshQueueCount();
        if (navigator.onLine && sessionToken) {
          void flushQueueWithToken(sessionToken);
        }
        if (navigator.onLine && firestoreConnected) {
          void flushFirestoreNow();
        }
        if (appUser && sessionToken && navigator.onLine) {
          void refreshDashboardData(sessionToken);
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && appUser) {
        if (sessionToken) {
          void flushQueueWithToken(sessionToken);
        }
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
      }
    };

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    appUser,
    firestoreConnected,
    flushFirestoreNow,
    flushQueueWithToken,
    refreshDashboardData,
    refreshQueueCount,
    sessionToken,
  ]);

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

    saveStoredSession(token, user, false);
    setSessionToken(token);
    setAppUser(user);
    setInstitution(effectiveInst);
    setPendingStatusUser(null);
    setIsOfflineSession(false);
    setNeedsSetup(false);
    setLastSyncError(null);

    await cacheOfflineAuthCredential(username, password, user, recoveryCode);
    await setOfflineKV('institution', effectiveInst);
    await refreshQueueCount();
  };

  const applyLocalOfflineSession = async (user: AppUser) => {
    saveStoredSession(null, user, true);
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
    await enqueueEntityToFirestore(
      'institutions',
      INSTITUTION_DOC_ID,
      'upsert',
      buildInstitutionFirestorePayload(optimisticInst),
      `Profil Lembaga (${optimisticInst.name || 'Ar-Raudhah'})`
    );

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
        await enqueueEntityToFirestore(
          'institutions',
          INSTITUTION_DOC_ID,
          'upsert',
          buildInstitutionFirestorePayload(mergedInst),
          `Profil Lembaga (${mergedInst.name || 'Ar-Raudhah'})`
        );
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { url: res.url, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'institutions',
      INSTITUTION_DOC_ID,
      'upsert',
      buildInstitutionFirestorePayload(payload),
      `Profil Lembaga (${payload.name || 'Ar-Raudhah'})`
    );

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ institution: InstitutionProfile }>('/api/institution', {
          method: 'PUT',
          body: payload as unknown as Record<string, unknown>,
        });
        setInstitution(res.institution);
        await setOfflineKV('institution', res.institution);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
      saveStoredSession(sessionToken, res.user, false);
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
    saveStoredSession(sessionToken, updatedLocal, isOfflineSession);
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

  const openReconnectModal = useCallback(() => {
    setReconnectModalOpen(true);
  }, []);

  const closeReconnectModal = useCallback(() => {
    setReconnectModalOpen(false);
  }, []);

  const openCloudSyncModal = useCallback(() => {
    setCloudSyncModalOpen(true);
  }, []);

  const closeCloudSyncModal = useCallback(() => {
    setCloudSyncModalOpen(false);
  }, []);

  const clearPendingQueue = useCallback(async () => {
    await clearOfflineMutationQueue();
    await refreshQueueCount();
    setLastSyncError(null);
    setLastSyncReport([]);
  }, [refreshQueueCount]);

  const clearFirestoreQueue = useCallback(async () => {
    await clearFirestoreSyncQueue();
    await refreshQueueCount();
    setLastFirestoreSyncError(null);
    setLastFirestoreSyncReport([]);
  }, [refreshQueueCount]);

  const pullFromFirestore = useCallback(async () => {
    const pulled = await pullSnapshotFromFirestore();
    const [pendingApi, pendingFs] = await Promise.all([
      getOfflineMutationQueue(),
      getFirestoreSyncQueue(),
    ]);

    const pendingInst =
      pendingApi.some((m) => m.endpoint.startsWith('/api/institution')) ||
      pendingFs.some((f) => f.collection === 'institutions');

    let nextInst = institution;
    if (!pendingInst && pulled.institution) {
      const mergedLogo = pulled.institution.logoUrl || institution?.logoUrl || '';
      const mergedPhoto = pulled.institution.photoUrl || institution?.photoUrl || '';
      nextInst = {
        ...pulled.institution,
        logoUrl: mergedLogo,
        photoUrl: mergedPhoto,
      };
      setInstitution(nextInst);
      await setOfflineKV('institution', nextInst);
    }

    const mergeById = <T extends { id: string }>(
      localList: T[],
      cloudList: T[],
      protectedIds: Set<string>,
      enrich?: (localItem: T | undefined, cloudItem: T) => T
    ): T[] => {
      const map = new Map<string, T>();
      for (const item of localList) {
        map.set(item.id, item);
      }
      for (const cloudItem of cloudList) {
        if (protectedIds.has(cloudItem.id)) continue;
        const existingLocal = map.get(cloudItem.id);
        map.set(cloudItem.id, enrich ? enrich(existingLocal, cloudItem) : cloudItem);
      }
      return Array.from(map.values());
    };

    const extractPendingIds = (col: string, endpointPrefix: string) => {
      const ids = new Set<string>();
      for (const f of pendingFs) {
        if (f.collection === col) ids.add(f.docId);
      }
      for (const m of pendingApi) {
        if (m.endpoint.startsWith(endpointPrefix)) {
          const bodyId = typeof m.body?.id === 'string' ? m.body.id : '';
          const urlId = m.endpoint.split('/').pop() || '';
          if (bodyId) ids.add(bodyId);
          if (urlId) ids.add(urlId);
        }
      }
      return ids;
    };

    if (pulled.categories.length > 0) {
      const merged = mergeById(
        categories,
        pulled.categories,
        extractPendingIds('proposalCategories', '/api/categories')
      );
      setCategories(merged);
      await setOfflineKV('categories', merged);
    }

    if (pulled.templates.length > 0) {
      const merged = mergeById(
        templates,
        pulled.templates,
        extractPendingIds('proposalTemplates', '/api/templates')
      );
      setTemplates(merged);
      await setOfflineKV('templates', merged);
    }

    if (pulled.proposals.length > 0) {
      const merged = mergeById(
        proposals,
        pulled.proposals,
        extractPendingIds('proposals', '/api/proposals'),
        (localItem, cloudItem) => ({
          ...cloudItem,
          templateId: cloudItem.templateId || localItem?.templateId || '',
          recipientAddress: cloudItem.recipientAddress || localItem?.recipientAddress || '',
          attachmentIds:
            localItem?.attachmentIds?.length ? localItem.attachmentIds : cloudItem.attachmentIds,
        })
      );
      setProposals(merged);
      await setOfflineKV('proposals', merged);
    }

    if (pulled.budgets.length > 0) {
      const merged = mergeById(
        budgets,
        pulled.budgets,
        extractPendingIds('proposalBudgets', '/api/budgets')
      );
      setBudgets(merged);
      await setOfflineKV('budgets', merged);
    }

    if (pulled.attachments.length > 0) {
      const merged = mergeById(
        attachments,
        pulled.attachments,
        extractPendingIds('proposalAttachments', '/api/attachments'),
        (localItem, cloudItem) => ({
          ...cloudItem,
          fileUrl:
            cloudItem.fileUrl.startsWith('/offline-attachment/') && localItem?.fileUrl
              ? localItem.fileUrl
              : cloudItem.fileUrl,
        })
      );
      setAttachments(merged);
      await setOfflineKV('attachments', merged);
    }

    if (pulled.statusHistory.length > 0) {
      const merged = mergeById(
        statusHistory,
        pulled.statusHistory,
        new Set<string>()
      );
      setStatusHistory(merged);
      await setOfflineKV('statusHistory', merged);
    }

    return { counts: pulled.counts };
  }, [attachments, budgets, categories, institution, proposals, statusHistory, templates]);

  const syncFirestoreNow = useCallback(async () => {
    await resetFailedFirestoreItems();
    const skippedFromApi = await rescueApiQueueToFirestore();
    const existingFs = await getFirestoreSyncQueue();
    if (existingFs.length === 0 && skippedFromApi.length === 0 && (institution?.name || proposals.length > 0)) {
      await enqueueFullSnapshotToFirestore({
        institution,
        categories,
        templates,
        proposals,
        budgets,
        attachments,
        statusHistory,
      });
      await refreshQueueCount();
    }
    return flushFirestoreNow();
  }, [
    attachments,
    budgets,
    categories,
    flushFirestoreNow,
    institution,
    proposals,
    refreshQueueCount,
    rescueApiQueueToFirestore,
    statusHistory,
    templates,
  ]);

  const retryFailedFirestoreSync = useCallback(async () => {
    await resetFailedFirestoreItems();
    return flushFirestoreNow();
  }, [flushFirestoreNow]);

  const pushAllLocalToFirestore = useCallback(async () => {
    const enqueuedCount = await enqueueFullSnapshotToFirestore({
      institution,
      categories,
      templates,
      proposals,
      budgets,
      attachments,
      statusHistory,
    });
    await refreshQueueCount();
    const res = await flushFirestoreNow();
    return {
      enqueuedCount,
      ...res,
    };
  }, [
    attachments,
    budgets,
    categories,
    flushFirestoreNow,
    institution,
    proposals,
    refreshQueueCount,
    statusHistory,
    templates,
  ]);

  const connectFirestoreCloud = useCallback(async () => {
    if (!navigator.onLine) {
      throw new Error('Koneksi internet diperlukan untuk menghubungkan akun Google Firestore.');
    }
    const user = await signInFirebaseWithGoogle();
    setFirebaseUser(user);

    const skippedFromApi = await rescueApiQueueToFirestore();
    const existingQueue = await getFirestoreSyncQueue();
    if (existingQueue.length === 0 && skippedFromApi.length === 0) {
      await enqueueFullSnapshotToFirestore({
        institution,
        categories,
        templates,
        proposals,
        budgets,
        attachments,
        statusHistory,
      });
      await refreshQueueCount();
    }

    setFirestoreSyncing(true);
    try {
      const res = await processFirestoreSyncQueue({
        institutionFallback: institution,
        onQueueChange: setFirestoreQueue,
      });
      const combinedItems = [...res.items, ...skippedFromApi];
      setLastFirestoreSyncError(res.lastError);
      setLastFirestoreSyncReport(combinedItems);

      if (res.failedCount === 0 && !serverApiAvailable) {
        const remainingApi = await getOfflineMutationQueue();
        const skippedIds = new Set(skippedFromApi.map((s) => s.id));
        for (const item of remainingApi) {
          if (!skippedIds.has(item.id)) {
            await removeOfflineMutation(item.id);
          }
        }
        setLastSyncError(null);
        await refreshQueueCount();
      }
      return {
        ...res,
        items: combinedItems,
      };
    } finally {
      setFirestoreQueue(await getFirestoreSyncQueue());
      setFirestoreSyncing(false);
    }
  }, [
    attachments,
    budgets,
    categories,
    institution,
    proposals,
    refreshQueueCount,
    rescueApiQueueToFirestore,
    serverApiAvailable,
    statusHistory,
    templates,
  ]);

  const disconnectFirestoreCloud = useCallback(async () => {
    await signOutFirebase();
    setFirebaseUser(null);
    setLastFirestoreSyncError(null);
  }, []);

  const syncNow = useCallback(async (): Promise<{
    syncedCount: number;
    failedCount: number;
    lastError: string | null;
    items?: SyncItemReport[];
  }> => {
    if (!navigator.onLine) {
      return {
        syncedCount: 0,
        failedCount: 0,
        lastError: 'Perangkat masih offline. Hubungkan ke internet terlebih dahulu.',
      };
    }

    if (!serverApiAvailable) {
      if (!firestoreConnected) {
        setCloudSyncModalOpen(true);
        return {
          syncedCount: 0,
          failedCount: 0,
          lastError: 'Hubungkan akun Google Firestore untuk menyinkronkan perubahan lokal secara online.',
        };
      }
      return syncFirestoreNow();
    }

    if (!sessionToken) {
      setReconnectModalOpen(true);
      return {
        syncedCount: 0,
        failedCount: 0,
        lastError: 'Sesi server belum aktif. Masukkan kata sandi untuk menyambung dan menyinkronkan.',
      };
    }
    const serverRes = await flushQueueWithToken(sessionToken);
    if (firestoreConnected) {
      await flushFirestoreNow();
    }
    return serverRes;
  }, [
    firestoreConnected,
    flushFirestoreNow,
    flushQueueWithToken,
    serverApiAvailable,
    sessionToken,
    syncFirestoreNow,
  ]);

  const reconnectServerSession = useCallback(
    async (
      password: string,
      options?: { approverUsername?: string; approverPassword?: string }
    ): Promise<{
      syncedCount: number;
      failedCount: number;
      lastError: string | null;
      items?: SyncItemReport[];
    }> => {
      if (!appUser) {
        throw new Error('Tidak ada akun aktif yang dapat dihubungkan.');
      }
      if (!navigator.onLine) {
        throw new Error('Perangkat masih offline. Hubungkan ke internet terlebih dahulu.');
      }

      const username = (appUser.username || appUser.displayName || '').trim();
      if (!username) {
        throw new Error('Nama pengguna tidak ditemukan pada sesi lokal.');
      }

      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const loginParsed = await parseJsonResponse<{
        token?: string;
        user?: AppUser;
        institution?: InstitutionProfile;
        error?: unknown;
      }>(loginRes);

      const loginErrText = extractErrorMessage(loginParsed.data, '');
      const isServerEndpointMissing =
        !loginParsed.isJson ||
        loginRes.status === 404 ||
        loginRes.status >= 500 ||
        loginErrText.toLowerCase().includes('page could not be found');

      if (isServerEndpointMissing) {
        setServerApiAvailable(false);
        throw new Error(
          'Server backend (/api) belum merespons atau tidak tersedia pada alamat ini. Data Anda tetap tersimpan lokal; gunakan Sinkronisasi Cloud Firestore untuk mencadangkan data secara online.'
        );
      }
      setServerApiAvailable(true);

      let activeToken = loginParsed.data?.token;
      let activeUser = loginParsed.data?.user;
      let activeInst = loginParsed.data?.institution;
      let registrationErrorMsg: string | null = null;
      let bootstrappedFreshServer = false;

      if ((!loginParsed.ok || !activeToken || !activeUser) && appUser.uid.startsWith('local_')) {
        const bootRes = await fetch('/api/auth/bootstrap-status', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const bootParsed = await parseJsonResponse<{ needsSetup?: boolean }>(bootRes);

        if (bootParsed.ok && bootParsed.data?.needsSetup && appUser.role === 'Administrator') {
          const setupRes = await fetch('/api/auth/setup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              username,
              displayName: appUser.displayName || username,
              password,
            }),
          });
          const setupParsed = await parseJsonResponse<{
            token?: string;
            user?: AppUser;
            institution?: InstitutionProfile;
            error?: unknown;
          }>(setupRes);
          if (setupParsed.ok && setupParsed.data?.token && setupParsed.data?.user) {
            activeToken = setupParsed.data.token;
            activeUser = setupParsed.data.user;
            activeInst = setupParsed.data.institution;
            bootstrappedFreshServer = true;
          } else if (!setupParsed.ok) {
            registrationErrorMsg = extractErrorMessage(
              setupParsed.data,
              'Gagal mendaftarkan akun Administrator ke server.'
            );
          }
        } else if (loginRes.status === 401) {
          const regRes = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              username,
              displayName: appUser.displayName || username,
              password,
              role: appUser.role,
              approverUsername: options?.approverUsername?.trim() || undefined,
              approverPassword: options?.approverPassword || undefined,
            }),
          });
          const regParsed = await parseJsonResponse<{
            autoActivated?: boolean;
            token?: string;
            user?: AppUser;
            institution?: InstitutionProfile;
            error?: unknown;
          }>(regRes);
          if (regParsed.ok && regParsed.data?.token && regParsed.data?.user) {
            activeToken = regParsed.data.token;
            activeUser = regParsed.data.user;
            activeInst = regParsed.data.institution;
          } else if (regParsed.ok && regParsed.data?.autoActivated === false) {
            throw new Error(
              'Akun lokal telah dikirim ke server dan menunggu aktivasi oleh Administrator server.'
            );
          } else if (regRes.status === 403 && appUser.role === 'Administrator') {
            throw new Error(
              'NEEDS_APPROVER:Server sudah memiliki Administrator aktif. Masukkan kredensial Administrator server yang sudah aktif (atau Kode Akses Server) untuk menyetujui akun lokal ini.'
            );
          } else if (regRes.status === 409) {
            registrationErrorMsg =
              'Nama pengguna tersebut sudah terdaftar di server dengan kata sandi berbeda. Masukkan kata sandi akun server yang sesuai.';
          } else if (!regParsed.ok) {
            registrationErrorMsg = extractErrorMessage(
              regParsed.data,
              'Gagal menyambungkan akun lokal ke server.'
            );
          }
        }
      }

      if (!activeToken || !activeUser) {
        throw new Error(
          registrationErrorMsg ||
            extractErrorMessage(
              loginParsed.data,
              'Kata sandi tidak sesuai atau akun belum terdaftar di server.'
            )
        );
      }

      // Preserve local institution profile, master data, proposals, and RAB if server storage was freshly initialized empty
      if (bootstrappedFreshServer) {
        const existingQueue = await getOfflineMutationQueue();

        if (
          institution &&
          (institution.name || institution.logoUrl || institution.photoUrl || institution.history) &&
          (!activeInst || !activeInst.name) &&
          !existingQueue.some((m) => m.endpoint === '/api/institution')
        ) {
          await enqueueOfflineMutation({
            endpoint: '/api/institution',
            method: 'PUT',
            body: institution as unknown as Record<string, unknown>,
          });
        }

        for (const cat of categories) {
          const queuedAlready = existingQueue.some(
            (m) => m.endpoint.includes(cat.id) || m.body?.id === cat.id
          );
          if (!queuedAlready) {
            await enqueueOfflineMutation({
              endpoint: `/api/categories/${cat.id}`,
              method: 'PUT',
              body: cat as unknown as Record<string, unknown>,
            });
          }
        }

        for (const tpl of templates) {
          const queuedAlready = existingQueue.some(
            (m) => m.endpoint.includes(tpl.id) || m.body?.id === tpl.id
          );
          if (!queuedAlready) {
            await enqueueOfflineMutation({
              endpoint: `/api/templates/${tpl.id}`,
              method: 'PUT',
              body: tpl as unknown as Record<string, unknown>,
            });
          }
        }

        for (const prop of proposals) {
          const queuedAlready = existingQueue.some(
            (m) => m.endpoint.includes(prop.id) || m.body?.id === prop.id
          );
          if (!queuedAlready) {
            await enqueueOfflineMutation({
              endpoint: `/api/proposals/${prop.id}`,
              method: 'PUT',
              body: prop as unknown as Record<string, unknown>,
            });
          }
        }

        for (const budget of budgets) {
          const queuedAlready = existingQueue.some(
            (m) =>
              m.endpoint.includes(budget.id) ||
              m.body?.id === budget.id ||
              (m.endpoint === '/api/budgets' && m.body?.proposalId === budget.proposalId)
          );
          if (!queuedAlready) {
            await enqueueOfflineMutation({
              endpoint: `/api/budgets/${budget.id}`,
              method: 'PUT',
              body: budget as unknown as Record<string, unknown>,
            });
          }
        }
      }

      await applyAuthenticatedSession(
        username,
        password,
        activeToken,
        activeUser,
        activeInst || EMPTY_INSTITUTION
      );

      return flushQueueWithToken(activeToken);
    },
    [appUser, budgets, categories, flushQueueWithToken, institution, proposals, templates]
  );

  const generateAiNarrative = async (
    payload: AiNarrativeRequest
  ): Promise<AiNarrativeResponse> => {
    if (!navigator.onLine) {
      throw new Error('Pembuatan narasi menggunakan AI memerlukan koneksi internet yang aktif.');
    }
    if (!sessionToken) {
      setReconnectModalOpen(true);
      throw new Error(
        'Sesi server belum aktif. Silakan masukkan kata sandi pada jendela penghubungan untuk mengaktifkan AI.'
      );
    }
    try {
      return await apiRequest<AiNarrativeResponse>('/api/ai/generate-narrative', {
        method: 'POST',
        body: payload as unknown as Record<string, unknown>,
      });
    } catch (err) {
      if (err instanceof AuthSessionError) {
        downgradeToOfflineSession();
        setReconnectModalOpen(true);
        throw new Error(
          'Sesi server kedaluwarsa. Masukkan kata sandi pada jendela penghubungan untuk melanjutkan pembuatan narasi AI.'
        );
      }
      throw err;
    }
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
    await enqueueEntityToFirestore(
      'proposalCategories',
      localCat.id,
      'upsert',
      buildCategoryFirestorePayload(localCat),
      `Kategori: ${localCat.name}`
    );

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
          ? nextCats.map((c) => (c.id === res.category.id ? res.category : c))
          : [...nextCats.filter((c) => c.id !== localCat.id), res.category];
        setCategories(synced);
        await setOfflineKV('categories', synced);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { category: res.category, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'proposalCategories',
      id,
      'delete',
      {},
      `Hapus Kategori (${id})`
    );

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/categories/${id}`, { method: 'DELETE' });
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'proposalTemplates',
      localTpl.id,
      'upsert',
      buildTemplateFirestorePayload(localTpl),
      `Template: ${localTpl.name}`
    );

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
          ? nextTpls.map((t) => (t.id === res.template.id ? res.template : t))
          : [...nextTpls.filter((t) => t.id !== localTpl.id), res.template];
        setTemplates(synced);
        await setOfflineKV('templates', synced);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { template: res.template, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
        await enqueueEntityToFirestore(
          'proposalTemplates',
          res.template.id,
          'upsert',
          buildTemplateFirestorePayload(res.template),
          `Template: ${res.template.name}`
        );
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { template: res.template, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'proposalTemplates',
      id,
      'delete',
      {},
      `Hapus Template (${id})`
    );

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/templates/${id}`, { method: 'DELETE' });
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'proposals',
      localProposal.id,
      'upsert',
      buildProposalFirestorePayload(localProposal),
      `Proposal: ${localProposal.title}`
    );
    if (localProposal.isArchived) {
      await enqueueEntityToFirestore(
        'proposalArchives',
        localProposal.id,
        'upsert',
        buildArchiveFirestorePayload(localProposal),
        `Arsip: ${localProposal.title}`
      );
    }

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
          ? nextProps.map((p) => (p.id === res.proposal.id ? res.proposal : p))
          : [res.proposal, ...nextProps.filter((p) => p.id !== localId)];
        setProposals(synced);
        await setOfflineKV('proposals', synced);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
        await enqueueEntityToFirestore(
          'proposals',
          res.proposal.id,
          'upsert',
          buildProposalFirestorePayload(res.proposal),
          `Proposal: ${res.proposal.title}`
        );
        await refreshDashboardData();
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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

    await enqueueEntityToFirestore(
      'proposals',
      id,
      'upsert',
      buildProposalFirestorePayload(updatedLocal),
      `Update Status Proposal: ${updatedLocal.title} (${payload.status})`
    );
    await enqueueEntityToFirestore(
      'proposalStatusHistory',
      localHist.id,
      'upsert',
      buildStatusHistoryFirestorePayload(localHist),
      `Riwayat Status: ${updatedLocal.title} -> ${payload.status}`
    );

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{
          proposal: ProposalRecord;
          historyEntry: ProposalStatusHistory;
        }>(`/api/proposals/${id}/status`, {
          method: 'PATCH',
          body: payload as unknown as Record<string, unknown>,
        });
        const syncedProps = nextProps.map((p) => (p.id === id ? res.proposal : p));
        setProposals(syncedProps);
        await setOfflineKV('proposals', syncedProps);
        const syncedHist = [res.historyEntry, ...nextHist.filter((h) => h.id !== localHist.id)];
        setStatusHistory(syncedHist);
        await setOfflineKV('statusHistory', syncedHist);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { proposal: res.proposal, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore('proposals', id, 'delete', {}, `Hapus Proposal (${id})`);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/proposals/${id}`, { method: 'DELETE' });
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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

    if (linkedProp) {
      await enqueueEntityToFirestore(
        'proposals',
        linkedProp.id,
        'upsert',
        buildProposalFirestorePayload({ ...linkedProp, totalBudget: totalAmount, updatedAt: now }),
        `Proposal: ${linkedProp.title}`
      );
    }
    await enqueueEntityToFirestore(
      'proposalBudgets',
      localBudget.id,
      'upsert',
      buildBudgetFirestorePayload(localBudget),
      `RAB: ${localBudget.title}`
    );

    if (navigator.onLine && sessionToken) {
      try {
        const res = await apiRequest<{ budget: ProposalBudget }>('/api/budgets', {
          method: 'POST',
          body: localBudget as unknown as Record<string, unknown>,
        });
        const syncedBudgets = existing
          ? nextBudgets.map((b) => (b.id === res.budget.id ? res.budget : b))
          : [res.budget, ...nextBudgets.filter((b) => b.id !== localBudget.id)];
        setBudgets(syncedBudgets);
        await setOfflineKV('budgets', syncedBudgets);
        const syncedProps = nextProps.map((p) =>
          p.id === payload.proposalId ? { ...p, totalBudget: res.budget.totalAmount } : p
        );
        setProposals(syncedProps);
        await setOfflineKV('proposals', syncedProps);
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { budget: res.budget, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore('proposalBudgets', id, 'delete', {}, `Hapus RAB (${id})`);

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/budgets/${id}`, { method: 'DELETE' });
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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

    const attFsPayload = buildAttachmentFirestorePayload(localAtt);
    if (attFsPayload) {
      await enqueueEntityToFirestore(
        'proposalAttachments',
        attId,
        'upsert',
        attFsPayload,
        `Lampiran: ${localAtt.title}`
      );
    }

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
        const synced = [res.attachment, ...nextAtts.filter((a) => a.id !== attId)];
        setAttachments(synced);
        await setOfflineKV('attachments', synced);
        const syncedFsPayload = buildAttachmentFirestorePayload(res.attachment);
        if (syncedFsPayload) {
          await enqueueEntityToFirestore(
            'proposalAttachments',
            res.attachment.id,
            'upsert',
            syncedFsPayload,
            `Lampiran: ${res.attachment.title}`
          );
        }
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { attachment: res.attachment, queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    await enqueueEntityToFirestore(
      'proposalAttachments',
      id,
      'delete',
      {},
      `Hapus Lampiran (${id})`
    );

    if (navigator.onLine && sessionToken) {
      try {
        await apiRequest(`/api/attachments/${id}`, { method: 'DELETE' });
        await refreshQueueCount();
        if (firestoreConnected) {
          void flushFirestoreNow();
        }
        return { queuedOffline: false };
      } catch (err) {
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
        if (err instanceof AuthSessionError) {
          downgradeToOfflineSession();
        } else if (!(err instanceof TypeError) && !(err instanceof RecoverableTransportError)) {
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
    clearStoredSession();
    void setOfflineKV('swSyncToken', null);
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
    setReconnectModalOpen(false);
    setCloudSyncModalOpen(false);
    setLastSyncError(null);
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
        serverApiAvailable,
        hasServerSession: Boolean(sessionToken),
        pendingSyncCount,
        pendingSyncItems,
        syncing,
        lastSyncError,
        lastSyncReport,
        reconnectModalOpen,
        openReconnectModal,
        closeReconnectModal,
        syncNow,
        clearPendingQueue,
        reconnectServerSession,
        firebaseUser,
        firestoreConnected,
        firestoreQueue,
        pendingFirestoreCount,
        firestoreSyncing,
        lastFirestoreSyncError,
        lastFirestoreSyncReport,
        cloudSyncModalOpen,
        openCloudSyncModal,
        closeCloudSyncModal,
        connectFirestoreCloud,
        disconnectFirestoreCloud,
        syncFirestoreNow,
        pullFromFirestore,
        pushAllLocalToFirestore,
        clearFirestoreQueue,
        retryFailedFirestoreSync,
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
