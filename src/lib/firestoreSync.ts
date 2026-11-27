import { GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './firebase';
import { recordAuditLog } from './audit';
import {
  describeOfflineMutation,
  enqueueFirestoreMutation,
  FirestoreSyncCollection,
  FirestoreSyncItem,
  getFirestoreSyncQueue,
  OfflineSyncMutation,
  removeFirestoreSyncItem,
  SyncItemReport,
  updateFirestoreSyncItem,
} from './offlineDb';
import {
  AppUser,
  BLUEPRINT_LIMITS,
  BOOTSTRAPPED_ADMIN_EMAIL,
  INSTITUTION_DOC_ID,
  InstitutionProfile,
  PROPOSAL_STATUS_ORDER,
  ProposalAttachment,
  ProposalBudget,
  ProposalCategory,
  ProposalRecord,
  ProposalStatusHistory,
  ProposalTemplate,
  UserRole,
  UserStatus,
} from '../types/models';
import { sanitizeString } from './formatters';

export function sanitizeFirestoreId(rawId: string, fallbackPrefix = 'doc'): string {
  const cleaned = (rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

function sanitizeOptionalUrl(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return trimmed.length <= maxLen && !trimmed.startsWith('data:') ? trimmed : '';
  }
  return trimmed.slice(0, maxLen);
}

function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export function buildInstitutionFirestorePayload(
  inst: InstitutionProfile
): Record<string, unknown> {
  return {
    name: sanitizeString(inst.name || '', BLUEPRINT_LIMITS.institution.nameMax),
    logoUrl: sanitizeOptionalUrl(inst.logoUrl, BLUEPRINT_LIMITS.institution.logoUrlMax),
    photoUrl: sanitizeOptionalUrl(inst.photoUrl, BLUEPRINT_LIMITS.institution.photoUrlMax),
    address: sanitizeString(inst.address || '', BLUEPRINT_LIMITS.institution.addressMax),
    kecamatan: sanitizeString(inst.kecamatan || '', BLUEPRINT_LIMITS.institution.kecamatanMax),
    kabupaten: sanitizeString(inst.kabupaten || '', BLUEPRINT_LIMITS.institution.kabupatenMax),
    provinsi: sanitizeString(inst.provinsi || '', BLUEPRINT_LIMITS.institution.provinsiMax),
    negara: sanitizeString(inst.negara || '', BLUEPRINT_LIMITS.institution.negaraMax),
    phone: sanitizeString(inst.phone || '', BLUEPRINT_LIMITS.institution.phoneMax),
    email: sanitizeString(inst.email || '', BLUEPRINT_LIMITS.institution.emailMax),
    foundedYear: sanitizeString(inst.foundedYear || '', BLUEPRINT_LIMITS.institution.foundedYearMax),
    statisticNumber: sanitizeString(
      inst.statisticNumber || '',
      BLUEPRINT_LIMITS.institution.statisticNumberMax
    ),
    legalityInfo: sanitizeString(
      inst.legalityInfo || '',
      BLUEPRINT_LIMITS.institution.legalityInfoMax
    ),
    leaderName: sanitizeString(inst.leaderName || '', BLUEPRINT_LIMITS.institution.leaderNameMax),
    history: sanitizeString(inst.history || '', BLUEPRINT_LIMITS.institution.historyMax),
    vision: sanitizeString(inst.vision || '', BLUEPRINT_LIMITS.institution.visionMax),
    mission: sanitizeString(inst.mission || '', BLUEPRINT_LIMITS.institution.missionMax),
    organizationStructure: sanitizeString(
      inst.organizationStructure || '',
      BLUEPRINT_LIMITS.institution.organizationStructureMax
    ),
    studentCount: clampNumber(inst.studentCount, 0, 1000000, 0),
    teacherCount: clampNumber(inst.teacherCount, 0, 1000000, 0),
  };
}

export function buildCategoryFirestorePayload(
  cat: ProposalCategory
): Record<string, unknown> {
  const safeName = sanitizeString(cat.name, 150);
  return {
    institutionId: INSTITUTION_DOC_ID,
    name: safeName.length >= 2 ? safeName : `${safeName}_`.slice(0, 150),
    code: sanitizeString(cat.code || '', 30),
    description: sanitizeString(cat.description || '', 1000),
    isActive: cat.isActive !== false,
  };
}

export function buildTemplateFirestorePayload(
  tpl: ProposalTemplate
): Record<string, unknown> {
  const safeName = sanitizeString(tpl.name, 150);
  const safeSections = Array.isArray(tpl.sections)
    ? tpl.sections.slice(0, 50).map((s) => ({
        id: sanitizeString(s.id || '', 128),
        key: sanitizeString(s.key || '', 100),
        title: sanitizeString(s.title || '', 200),
        description: sanitizeString(s.description || '', 1000),
        defaultContent: sanitizeString(s.defaultContent || '', 5000),
        order: Number(s.order) || 1,
        enabled: s.enabled !== false,
        required: Boolean(s.required),
      }))
    : [];
  return {
    institutionId: INSTITUTION_DOC_ID,
    name: safeName.length >= 2 ? safeName : `${safeName}_`.slice(0, 150),
    type: sanitizeString(tpl.proposalType || 'Umum', 100),
    description: sanitizeString(tpl.description || '', 1000),
    sections: safeSections,
    isActive: tpl.isActive !== false,
  };
}

export function buildProposalFirestorePayload(
  prop: ProposalRecord
): Record<string, unknown> {
  const safeTitle = sanitizeString(prop.title, 300);
  const normalizedTitle =
    safeTitle.length >= 3 ? safeTitle : (safeTitle || 'Proposal').padEnd(3, '.');
  const safeStatus = PROPOSAL_STATUS_ORDER.includes(prop.status) ? prop.status : 'Draft';
  const safeSections = Array.isArray(prop.sections)
    ? prop.sections.slice(0, 50).map((s) => ({
        id: sanitizeString(s.id || '', 128),
        key: sanitizeString(s.key || '', 100),
        title: sanitizeString(s.title || '', 200),
        content: sanitizeString(s.content || '', 10000),
        enabled: s.enabled !== false,
        order: Number(s.order) || 1,
      }))
    : [];

  const getSection = (keyPart: string, maxLen: number) => {
    const matched = safeSections.find((s) =>
      s.key.toLowerCase().includes(keyPart.toLowerCase())
    );
    return sanitizeString(matched?.content || '', maxLen);
  };

  return {
    institutionId: INSTITUTION_DOC_ID,
    proposalNumber: sanitizeString(prop.proposalNumber || '', 100),
    proposalDate: sanitizeString(prop.proposalDate || '', 30),
    fiscalYear: clampNumber(prop.fiscalYear, 2000, 2100, new Date().getFullYear()),
    title: normalizedTitle,
    categoryId: sanitizeString(prop.categoryId || '', 128),
    categoryName: sanitizeString(prop.categoryName || '', 150),
    proposalType: sanitizeString(prop.proposalType || '', 150),
    recipientName: sanitizeString(prop.recipientName || '', 200),
    recipientInstitution: sanitizeString(prop.recipientInstitution || '', 200),
    status: safeStatus,
    totalBudget: clampNumber(prop.totalBudget, 0, 1e14, 0),
    approvedAmount: clampNumber(prop.approvedAmount, 0, 1e14, 0),
    receivedAmount: clampNumber(prop.receivedAmount, 0, 1e14, 0),
    submittedAt: sanitizeString(prop.submittedAt || '', 40),
    followUpNotes: sanitizeString(prop.followUpNotes || '', 3000),
    background: getSection('latar_belakang', 20000),
    purpose: getSection('tujuan', 10000),
    target: getSection('sasaran', 10000),
    location: sanitizeString(prop.location || '', 1000),
    executionTime: sanitizeString(prop.executionTime || '', 500),
    activityDescription: sanitizeString(
      prop.summary || getSection('pelaksanaan', 20000),
      20000
    ),
    requirementPlan: getSection('rencana_kebutuhan', 20000),
    closing: getSection('penutup', 10000),
    sectionsContent: safeSections,
  };
}

export function buildArchiveFirestorePayload(
  prop: ProposalRecord
): Record<string, unknown> {
  const safeTitle = sanitizeString(prop.title, 300);
  return {
    institutionId: INSTITUTION_DOC_ID,
    proposalId: sanitizeFirestoreId(prop.id, 'prop'),
    proposalNumber: sanitizeString(prop.proposalNumber || '', 100),
    title: safeTitle.length >= 3 ? safeTitle : (safeTitle || 'Proposal').padEnd(3, '.'),
    categoryName: sanitizeString(prop.categoryName || '', 150),
    fiscalYear: clampNumber(prop.fiscalYear, 2000, 2100, new Date().getFullYear()),
    proposalDate: sanitizeString(prop.proposalDate || '', 30),
    recipientInstitution: sanitizeString(prop.recipientInstitution || '', 200),
    totalBudget: clampNumber(prop.totalBudget, 0, 1e14, 0),
    status: sanitizeString(prop.status || 'Draft', 60) || 'Draft',
    exportedFileUrl: '',
  };
}

export function buildBudgetFirestorePayload(
  budget: ProposalBudget
): Record<string, unknown> {
  const safeItems = Array.isArray(budget.items)
    ? budget.items.slice(0, 200).map((it, idx) => ({
        id: sanitizeString(it.id || `item_${idx + 1}`, 128),
        groupName: sanitizeString(it.groupName || '', 150),
        order: Number(it.order) || idx + 1,
        description: sanitizeString(it.description || '', 300),
        volume: clampNumber(it.volume, 0, 1e9, 0),
        unit: sanitizeString(it.unit || '', 50),
        unitPrice: clampNumber(it.unitPrice, 0, 1e14, 0),
        totalPrice: clampNumber(it.totalPrice, 0, 1e14, 0),
      }))
    : [];
  return {
    institutionId: INSTITUTION_DOC_ID,
    proposalId: sanitizeFirestoreId(budget.proposalId, 'prop'),
    workGroup: sanitizeString(budget.title || 'RAB Utama', 150),
    items: safeItems,
    totalAmount: clampNumber(budget.totalAmount, 0, 1e14, 0),
  };
}

export function buildAttachmentFirestorePayload(
  att: ProposalAttachment
): Record<string, unknown> | null {
  if (!att.proposalId) return null;
  const safeId = sanitizeFirestoreId(att.id, 'att');
  const safeUrl =
    att.fileUrl && !att.fileUrl.startsWith('data:') && att.fileUrl.length <= 2000
      ? att.fileUrl
      : `/offline-attachment/${safeId}`;
  return {
    institutionId: INSTITUTION_DOC_ID,
    proposalId: sanitizeFirestoreId(att.proposalId, 'prop'),
    category: sanitizeString(att.category || 'Lainnya', 100) || 'Lainnya',
    title: sanitizeString(att.title || att.fileName || 'Lampiran', 200) || 'Lampiran',
    fileUrl: safeUrl,
    fileName: sanitizeString(att.fileName || '', 255),
    fileType: sanitizeString(att.mimeType || '', 100),
  };
}

export function buildStatusHistoryFirestorePayload(
  entry: ProposalStatusHistory
): Record<string, unknown> {
  return {
    institutionId: INSTITUTION_DOC_ID,
    proposalId: sanitizeFirestoreId(entry.proposalId, 'prop'),
    fromStatus: sanitizeString(entry.fromStatus || '', 60),
    toStatus: sanitizeString(entry.toStatus || 'Draft', 60) || 'Draft',
    notes: sanitizeString(entry.notes || '', 2000),
  };
}

export async function resolveFirebaseAppUser(user: FirebaseUser): Promise<AppUser> {
  if (!user.emailVerified) {
    throw new Error('Akun Google belum terverifikasi emailnya.');
  }

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  const isBootstrap =
    (user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

  if (snap && snap.exists()) {
    const d = snap.data();
    const role: UserRole =
      d.role === 'Administrator' || d.role === 'Pimpinan' || d.role === 'Operator'
        ? d.role
        : isBootstrap
        ? 'Administrator'
        : 'Operator';
    const status: UserStatus =
      d.status === 'active' || d.status === 'pending' || d.status === 'inactive'
        ? d.status
        : isBootstrap
        ? 'active'
        : 'pending';
    const emailStr = String(d.email || user.email || '');
    const derivedUsername = emailStr.includes('@')
      ? emailStr.split('@')[0]
      : String(d.uid || user.uid);
    return {
      uid: String(d.uid || user.uid),
      username: derivedUsername,
      displayName: String(d.displayName || user.displayName || emailStr || 'Pengguna'),
      email: emailStr,
      photoURL: String(d.photoURL || user.photoURL || ''),
      phone: String(d.phone || ''),
      position: String(
        d.position || (role === 'Administrator' ? 'Administrator Sistem' : '')
      ),
      role,
      status,
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
      createdBy: String(d.createdBy || user.uid),
      updatedBy: String(d.updatedBy || user.uid),
    };
  }

  const nowIso = new Date().toISOString();
  const safeUid = sanitizeFirestoreId(user.uid, 'usr');
  const emailStr = sanitizeString(user.email || 'user@arraudhah.local', 200);
  const displayName =
    sanitizeString(user.displayName || user.email || 'Pengguna', 150) || 'Pengguna';
  const role: UserRole = isBootstrap ? 'Administrator' : 'Operator';
  const status: UserStatus = isBootstrap ? 'active' : 'pending';
  const position = isBootstrap ? 'Administrator Sistem' : 'Operator';

  try {
    await setDoc(userRef, {
      uid: safeUid,
      displayName,
      email: emailStr,
      photoURL: sanitizeOptionalUrl(user.photoURL, BLUEPRINT_LIMITS.user.photoURLMax),
      phone: '',
      position,
      role,
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
      updatedBy: user.uid,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  return {
    uid: safeUid,
    username: emailStr.includes('@') ? emailStr.split('@')[0] : safeUid,
    displayName,
    email: emailStr,
    photoURL: user.photoURL || '',
    phone: '',
    position,
    role,
    status,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdBy: user.uid,
    updatedBy: user.uid,
  };
}

export async function fetchAllFirestoreUsersForAdmin(): Promise<AppUser[]> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return [];
  }
  try {
    const q = query(
      collection(db, 'users'),
      where('role', 'in', ['Administrator', 'Pimpinan', 'Operator'])
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const d = docSnap.data();
      const emailStr = String(d.email || '');
      const role: UserRole =
        d.role === 'Administrator' || d.role === 'Pimpinan' || d.role === 'Operator'
          ? d.role
          : 'Operator';
      const status: UserStatus =
        d.status === 'active' || d.status === 'pending' || d.status === 'inactive'
          ? d.status
          : 'pending';
      return {
        uid: String(d.uid || docSnap.id),
        username: emailStr.includes('@') ? emailStr.split('@')[0] : docSnap.id,
        displayName: String(d.displayName || emailStr || docSnap.id),
        email: emailStr,
        photoURL: String(d.photoURL || ''),
        phone: String(d.phone || ''),
        position: String(d.position || ''),
        role,
        status,
        createdAt: timestampToIso(d.createdAt),
        updatedAt: timestampToIso(d.updatedAt),
        createdBy: String(d.createdBy || ''),
        updatedBy: String(d.updatedBy || ''),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
}

export async function updateFirestoreUserForAdmin(
  targetUid: string,
  patch: {
    displayName: string;
    phone: string;
    position: string;
    role: UserRole;
    status: UserStatus;
  }
): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified || !targetUid) {
    return false;
  }
  const userPath = `users/${targetUid}`;
  const userRef = doc(db, 'users', targetUid);
  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      return false;
    }
    await updateDoc(userRef, {
      displayName: sanitizeString(patch.displayName, BLUEPRINT_LIMITS.user.displayNameMax) || 'Pengguna',
      phone: sanitizeString(patch.phone, BLUEPRINT_LIMITS.user.phoneMax),
      position: sanitizeString(patch.position, BLUEPRINT_LIMITS.user.positionMax),
      role: patch.role,
      status: patch.status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid,
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, userPath);
  }
}

export async function signInFirebaseWithGoogle(): Promise<FirebaseUser> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let user: FirebaseUser;
  try {
    const result = await signInWithPopup(auth, provider);
    user = result.user;
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Jendela login Google diblokir oleh peramban. Izinkan pop-up untuk situs ini lalu coba lagi.'
      );
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Login Google dibatalkan sebelum selesai.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain ini belum terdaftar di Authorized Domains Firebase Authentication.'
      );
    }
    throw err;
  }

  if (!user.emailVerified) {
    throw new Error('Akun Google belum terverifikasi emailnya.');
  }

  await testConnection();
  await resolveFirebaseAppUser(user);

  return user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

export async function ensureInstitutionInFirestore(
  inst: InstitutionProfile | null,
  uid: string
): Promise<void> {
  const instPath = `institutions/${INSTITUTION_DOC_ID}`;
  const instRef = doc(db, 'institutions', INSTITUTION_DOC_ID);
  let exists = false;
  try {
    const snap = await getDoc(instRef);
    exists = snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, instPath);
  }

  if (!exists) {
    const base = inst || {
      name: '',
      address: '',
      createdBy: uid,
      updatedBy: uid,
    };
    const payload = buildInstitutionFirestorePayload(base);
    try {
      await setDoc(instRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, instPath);
    }
  }
}

async function applyFirestoreItem(
  item: FirestoreSyncItem,
  uid: string
): Promise<void> {
  const safeId = sanitizeFirestoreId(item.docId, item.collection.slice(0, 4));
  const docPath = `${item.collection}/${safeId}`;
  const docRef = doc(db, item.collection, safeId);

  if (item.operation === 'delete') {
    if (item.collection === 'institutions' || item.collection === 'proposalStatusHistory') {
      return;
    }
    try {
      await deleteDoc(docRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
    return;
  }

  if (item.collection === 'proposalStatusHistory') {
    let exists = false;
    try {
      const snap = await getDoc(docRef);
      exists = snap.exists();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, docPath);
    }
    if (!exists) {
      try {
        await setDoc(docRef, {
          ...item.payload,
          createdAt: serverTimestamp(),
          createdBy: uid,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    }
    return;
  }

  let existingSnap;
  try {
    existingSnap = await getDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, docPath);
  }

  if (existingSnap && existingSnap.exists()) {
    const existingData = existingSnap.data();
    const updatePayload: Record<string, unknown> = {
      ...item.payload,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    };
    if (existingData.createdAt !== undefined) {
      updatePayload.createdAt = existingData.createdAt;
    }
    if (existingData.createdBy !== undefined) {
      updatePayload.createdBy = existingData.createdBy;
    }
    try {
      await updateDoc(docRef, updatePayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, docPath);
    }
  } else {
    try {
      await setDoc(docRef, {
        ...item.payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
        updatedBy: uid,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, docPath);
    }
  }
}

function formatFirestoreErrorForDisplay(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: string; path?: string };
    if (parsed?.error) {
      return parsed.path ? `${parsed.path}: ${parsed.error}` : parsed.error;
    }
  } catch {
    // Plain error message
  }
  return raw;
}

let firestoreSyncLock = false;

export async function processFirestoreSyncQueue(options?: {
  institutionFallback?: InstitutionProfile | null;
  onQueueChange?: (items: FirestoreSyncItem[]) => void;
}): Promise<{
  syncedCount: number;
  failedCount: number;
  lastError: string | null;
  items: SyncItemReport[];
}> {
  if (firestoreSyncLock) {
    return { syncedCount: 0, failedCount: 0, lastError: null, items: [] };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      syncedCount: 0,
      failedCount: 0,
      lastError: 'Perangkat masih offline. Perubahan menunggu koneksi internet.',
      items: [],
    };
  }
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return {
      syncedCount: 0,
      failedCount: 0,
      lastError: 'Akun Google Firestore belum terhubung.',
      items: [],
    };
  }

  const queue = await getFirestoreSyncQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, failedCount: 0, lastError: null, items: [] };
  }

  firestoreSyncLock = true;
  let syncedCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;
  const itemReports: SyncItemReport[] = [];

  try {
    const connected = await testConnection();
    if (!connected) {
      return {
        syncedCount: 0,
        failedCount: 0,
        lastError: 'Koneksi ke Firestore belum siap. Mencoba ulang saat online.',
        items: [],
      };
    }

    const needsInstitution = queue.some((q) => q.collection !== 'institutions');
    if (needsInstitution) {
      try {
        await ensureInstitutionInFirestore(
          options?.institutionFallback || null,
          currentUser.uid
        );
      } catch {
        // Non-admin operators might lack institution create permission if it already exists
      }
    }

    for (const item of queue) {
      await updateFirestoreSyncItem(item.id, { status: 'syncing', lastError: null });
      if (options?.onQueueChange) {
        options.onQueueChange(await getFirestoreSyncQueue());
      }

      try {
        await applyFirestoreItem(item, currentUser.uid);
        await removeFirestoreSyncItem(item.id);
        syncedCount += 1;
        itemReports.push({
          id: item.id,
          label: item.label,
          target: 'firestore',
          status: 'synced',
        });
      } catch (err) {
        failedCount += 1;
        lastError = formatFirestoreErrorForDisplay(err);
        await updateFirestoreSyncItem(item.id, {
          status: 'failed',
          retryCount: (item.retryCount || 0) + 1,
          lastError,
        });
        itemReports.push({
          id: item.id,
          label: item.label,
          target: 'firestore',
          status: 'failed',
          error: lastError,
        });
      }

      if (options?.onQueueChange) {
        options.onQueueChange(await getFirestoreSyncQueue());
      }
    }

    if (syncedCount > 0) {
      try {
        await recordAuditLog({
          action: 'FIRESTORE_BACKGROUND_SYNC',
          entityType: 'syncQueue',
          entityId: INSTITUTION_DOC_ID,
          actorUid: currentUser.uid,
          actorName: currentUser.displayName || currentUser.email || 'Pengguna',
          details: `Menyinkronkan ${syncedCount} perubahan lokal ke Firestore secara otomatis.`,
        });
      } catch {
        // Do not fail sync summary if audit append fails
      }
    }
  } finally {
    firestoreSyncLock = false;
    if (options?.onQueueChange) {
      options.onQueueChange(await getFirestoreSyncQueue());
    }
  }

  return { syncedCount, failedCount, lastError, items: itemReports };
}

export async function enqueueFullSnapshotToFirestore(snapshot: {
  institution: InstitutionProfile | null;
  categories: ProposalCategory[];
  templates: ProposalTemplate[];
  proposals: ProposalRecord[];
  budgets: ProposalBudget[];
  attachments: ProposalAttachment[];
  statusHistory: ProposalStatusHistory[];
}): Promise<number> {
  let count = 0;

  if (snapshot.institution) {
    await enqueueFirestoreMutation({
      collection: 'institutions',
      docId: INSTITUTION_DOC_ID,
      operation: 'upsert',
      payload: buildInstitutionFirestorePayload(snapshot.institution),
      label: `Profil Lembaga (${snapshot.institution.name || 'Ar-Raudhah'})`,
    });
    count += 1;
  }

  for (const cat of snapshot.categories) {
    await enqueueFirestoreMutation({
      collection: 'proposalCategories',
      docId: sanitizeFirestoreId(cat.id, 'cat'),
      operation: 'upsert',
      payload: buildCategoryFirestorePayload(cat),
      label: `Kategori: ${cat.name}`,
    });
    count += 1;
  }

  for (const tpl of snapshot.templates) {
    await enqueueFirestoreMutation({
      collection: 'proposalTemplates',
      docId: sanitizeFirestoreId(tpl.id, 'tpl'),
      operation: 'upsert',
      payload: buildTemplateFirestorePayload(tpl),
      label: `Template: ${tpl.name}`,
    });
    count += 1;
  }

  for (const prop of snapshot.proposals) {
    const safePropId = sanitizeFirestoreId(prop.id, 'prop');
    await enqueueFirestoreMutation({
      collection: 'proposals',
      docId: safePropId,
      operation: 'upsert',
      payload: buildProposalFirestorePayload(prop),
      label: `Proposal: ${prop.title}`,
    });
    count += 1;

    if (prop.isArchived) {
      await enqueueFirestoreMutation({
        collection: 'proposalArchives',
        docId: safePropId,
        operation: 'upsert',
        payload: buildArchiveFirestorePayload(prop),
        label: `Arsip: ${prop.title}`,
      });
      count += 1;
    }
  }

  for (const budget of snapshot.budgets) {
    await enqueueFirestoreMutation({
      collection: 'proposalBudgets',
      docId: sanitizeFirestoreId(budget.id, 'rab'),
      operation: 'upsert',
      payload: buildBudgetFirestorePayload(budget),
      label: `RAB: ${budget.title || budget.proposalTitle || budget.proposalId}`,
    });
    count += 1;
  }

  for (const att of snapshot.attachments) {
    const payload = buildAttachmentFirestorePayload(att);
    if (!payload) continue;
    await enqueueFirestoreMutation({
      collection: 'proposalAttachments',
      docId: sanitizeFirestoreId(att.id, 'att'),
      operation: 'upsert',
      payload,
      label: `Lampiran: ${att.title}`,
    });
    count += 1;
  }

  for (const hist of snapshot.statusHistory.slice(0, 50)) {
    await enqueueFirestoreMutation({
      collection: 'proposalStatusHistory',
      docId: sanitizeFirestoreId(hist.id, 'hist'),
      operation: 'upsert',
      payload: buildStatusHistoryFirestorePayload(hist),
      label: `Status Proposal -> ${hist.toStatus}`,
    });
    count += 1;
  }

  return count;
}

export async function enqueueEntityToFirestore(
  collectionName: FirestoreSyncCollection,
  docId: string,
  operation: 'upsert' | 'delete',
  payload: Record<string, unknown>,
  label: string
): Promise<void> {
  await enqueueFirestoreMutation({
    collection: collectionName,
    docId: sanitizeFirestoreId(docId, collectionName.slice(0, 4)),
    operation,
    payload,
    label,
  });
}

export async function enqueueSyncMutationsToFirestore(
  mutations: OfflineSyncMutation[],
  localSnapshot: {
    institution: InstitutionProfile | null;
    categories: ProposalCategory[];
    templates: ProposalTemplate[];
    proposals: ProposalRecord[];
    budgets: ProposalBudget[];
    attachments: ProposalAttachment[];
  }
): Promise<{ enqueuedCount: number; skippedReports: SyncItemReport[] }> {
  let enqueuedCount = 0;
  const skippedReports: SyncItemReport[] = [];

  for (const mut of mutations) {
    const label = describeOfflineMutation(mut);
    const body = (mut.body || {}) as Record<string, unknown>;
    const urlId = mut.endpoint.split('/').pop() || '';

    if (mut.endpoint === '/api/institution' || mut.endpoint === '/api/institution/upload') {
      const sourceInst = localSnapshot.institution || (body as unknown as InstitutionProfile);
      await enqueueFirestoreMutation({
        collection: 'institutions',
        docId: INSTITUTION_DOC_ID,
        operation: 'upsert',
        payload: buildInstitutionFirestorePayload(sourceInst),
        label,
      });
      enqueuedCount += 1;
      continue;
    }

    if (mut.endpoint.startsWith('/api/categories')) {
      const catId = sanitizeFirestoreId(
        (typeof body.id === 'string' && body.id) || (urlId !== 'categories' ? urlId : ''),
        'cat'
      );
      if (mut.method === 'DELETE') {
        await enqueueFirestoreMutation({
          collection: 'proposalCategories',
          docId: catId,
          operation: 'delete',
          payload: {},
          label,
        });
      } else {
        const matched = localSnapshot.categories.find((c) => c.id === catId);
        await enqueueFirestoreMutation({
          collection: 'proposalCategories',
          docId: catId,
          operation: 'upsert',
          payload: buildCategoryFirestorePayload(
            matched || (body as unknown as ProposalCategory)
          ),
          label,
        });
      }
      enqueuedCount += 1;
      continue;
    }

    if (mut.endpoint.startsWith('/api/templates')) {
      const tplId = sanitizeFirestoreId(
        (typeof body.id === 'string' && body.id) || (urlId !== 'templates' ? urlId : ''),
        'tpl'
      );
      if (mut.method === 'DELETE') {
        await enqueueFirestoreMutation({
          collection: 'proposalTemplates',
          docId: tplId,
          operation: 'delete',
          payload: {},
          label,
        });
      } else {
        const matched = localSnapshot.templates.find((t) => t.id === tplId);
        await enqueueFirestoreMutation({
          collection: 'proposalTemplates',
          docId: tplId,
          operation: 'upsert',
          payload: buildTemplateFirestorePayload(
            matched || (body as unknown as ProposalTemplate)
          ),
          label,
        });
      }
      enqueuedCount += 1;
      continue;
    }

    if (/^\/api\/proposals\/[^/]+\/status$/.test(mut.endpoint)) {
      const parts = mut.endpoint.split('/');
      const propId = sanitizeFirestoreId(parts[3] || '', 'prop');
      const matched = localSnapshot.proposals.find((p) => p.id === propId);
      if (matched) {
        await enqueueFirestoreMutation({
          collection: 'proposals',
          docId: propId,
          operation: 'upsert',
          payload: buildProposalFirestorePayload(matched),
          label: `Proposal: ${matched.title}`,
        });
        enqueuedCount += 1;
      } else {
        skippedReports.push({
          id: mut.id,
          label,
          target: 'firestore',
          status: 'skipped',
          error: 'Data proposal induk tidak ditemukan di cache lokal.',
        });
      }
      continue;
    }

    if (mut.endpoint.startsWith('/api/proposals')) {
      const propId = sanitizeFirestoreId(
        (typeof body.id === 'string' && body.id) || (urlId !== 'proposals' ? urlId : ''),
        'prop'
      );
      if (mut.method === 'DELETE') {
        await enqueueFirestoreMutation({
          collection: 'proposals',
          docId: propId,
          operation: 'delete',
          payload: {},
          label,
        });
      } else {
        const matched = localSnapshot.proposals.find((p) => p.id === propId);
        const sourceProp = matched || (body as unknown as ProposalRecord);
        await enqueueFirestoreMutation({
          collection: 'proposals',
          docId: propId,
          operation: 'upsert',
          payload: buildProposalFirestorePayload(sourceProp),
          label,
        });
        if (sourceProp.isArchived) {
          await enqueueFirestoreMutation({
            collection: 'proposalArchives',
            docId: propId,
            operation: 'upsert',
            payload: buildArchiveFirestorePayload(sourceProp),
            label: `Arsip: ${sourceProp.title}`,
          });
        }
      }
      enqueuedCount += 1;
      continue;
    }

    if (mut.endpoint.startsWith('/api/budgets')) {
      const budgetId = sanitizeFirestoreId(
        (typeof body.id === 'string' && body.id) || (urlId !== 'budgets' ? urlId : ''),
        'rab'
      );
      if (mut.method === 'DELETE') {
        await enqueueFirestoreMutation({
          collection: 'proposalBudgets',
          docId: budgetId,
          operation: 'delete',
          payload: {},
          label,
        });
      } else {
        const matched = localSnapshot.budgets.find(
          (b) => b.id === budgetId || b.proposalId === body.proposalId
        );
        await enqueueFirestoreMutation({
          collection: 'proposalBudgets',
          docId: sanitizeFirestoreId(matched?.id || budgetId, 'rab'),
          operation: 'upsert',
          payload: buildBudgetFirestorePayload(
            matched || (body as unknown as ProposalBudget)
          ),
          label,
        });
      }
      enqueuedCount += 1;
      continue;
    }

    if (mut.endpoint.startsWith('/api/attachments')) {
      const attId = sanitizeFirestoreId(
        (typeof body.id === 'string' && body.id) || (urlId !== 'attachments' ? urlId : ''),
        'att'
      );
      if (mut.method === 'DELETE') {
        await enqueueFirestoreMutation({
          collection: 'proposalAttachments',
          docId: attId,
          operation: 'delete',
          payload: {},
          label,
        });
        enqueuedCount += 1;
      } else {
        const matched = localSnapshot.attachments.find((a) => a.id === attId);
        const payload = buildAttachmentFirestorePayload(
          matched || (body as unknown as ProposalAttachment)
        );
        if (payload) {
          await enqueueFirestoreMutation({
            collection: 'proposalAttachments',
            docId: attId,
            operation: 'upsert',
            payload,
            label,
          });
          enqueuedCount += 1;
        } else {
          skippedReports.push({
            id: mut.id,
            label,
            target: 'firestore',
            status: 'skipped',
            error: 'Lampiran belum tertaut ke proposal tertentu (disimpan lokal).',
          });
        }
      }
      continue;
    }

    skippedReports.push({
      id: mut.id,
      label,
      target: 'firestore',
      status: 'skipped',
      error: 'Pengaturan/profil akun lokal tidak memerlukan koleksi Firestore terpisah.',
    });
  }

  return { enqueuedCount, skippedReports };
}

function timestampToIso(value: unknown, fallback = ''): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toDate?: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return fallback;
}

export interface PulledFirestoreSnapshot {
  institution: InstitutionProfile | null;
  categories: ProposalCategory[];
  templates: ProposalTemplate[];
  proposals: ProposalRecord[];
  budgets: ProposalBudget[];
  attachments: ProposalAttachment[];
  statusHistory: ProposalStatusHistory[];
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
}

export async function pullSnapshotFromFirestore(): Promise<PulledFirestoreSnapshot> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Akun Google Firestore belum terhubung.');
  }

  const connected = await testConnection();
  if (!connected) {
    throw new Error('Koneksi ke Cloud Firestore tidak tersedia saat ini.');
  }

  let institution: InstitutionProfile | null = null;
  const instPath = `institutions/${INSTITUTION_DOC_ID}`;
  try {
    const instSnap = await getDoc(doc(db, 'institutions', INSTITUTION_DOC_ID));
    if (instSnap.exists()) {
      const d = instSnap.data();
      institution = {
        name: String(d.name || ''),
        logoUrl: String(d.logoUrl || ''),
        photoUrl: String(d.photoUrl || ''),
        address: String(d.address || ''),
        kecamatan: String(d.kecamatan || ''),
        kabupaten: String(d.kabupaten || ''),
        provinsi: String(d.provinsi || ''),
        negara: String(d.negara || ''),
        phone: String(d.phone || ''),
        email: String(d.email || ''),
        foundedYear: String(d.foundedYear || ''),
        statisticNumber: String(d.statisticNumber || ''),
        legalityInfo: String(d.legalityInfo || ''),
        leaderName: String(d.leaderName || ''),
        history: String(d.history || ''),
        vision: String(d.vision || ''),
        mission: String(d.mission || ''),
        organizationStructure: String(d.organizationStructure || ''),
        studentCount: Number(d.studentCount) || 0,
        teacherCount: Number(d.teacherCount) || 0,
        createdAt: timestampToIso(d.createdAt),
        updatedAt: timestampToIso(d.updatedAt),
        createdBy: String(d.createdBy || ''),
        updatedBy: String(d.updatedBy || ''),
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, instPath);
  }

  const fetchCollectionDocs = async (colName: string) => {
    try {
      const q = query(
        collection(db, colName),
        where('institutionId', '==', INSTITUTION_DOC_ID)
      );
      const snap = await getDocs(q);
      return snap.docs;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colName);
    }
  };

  const [catDocs, tplDocs, propDocs, budgetDocs, attDocs, archiveDocs, histDocs] =
    await Promise.all([
      fetchCollectionDocs('proposalCategories'),
      fetchCollectionDocs('proposalTemplates'),
      fetchCollectionDocs('proposals'),
      fetchCollectionDocs('proposalBudgets'),
      fetchCollectionDocs('proposalAttachments'),
      fetchCollectionDocs('proposalArchives'),
      fetchCollectionDocs('proposalStatusHistory'),
    ]);

  const categories: ProposalCategory[] = catDocs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      name: String(d.name || ''),
      code: String(d.code || ''),
      description: String(d.description || ''),
      isActive: d.isActive !== false,
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
    };
  });

  const templates: ProposalTemplate[] = tplDocs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      name: String(d.name || ''),
      proposalType: String(d.type || 'Umum'),
      description: String(d.description || ''),
      sections: Array.isArray(d.sections) ? d.sections : [],
      isDefault: false,
      isActive: d.isActive !== false,
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
      createdBy: String(d.createdBy || ''),
      updatedBy: String(d.updatedBy || ''),
    };
  });

  const archivedProposalIds = new Set(
    archiveDocs.map((docSnap) => String(docSnap.data().proposalId || docSnap.id))
  );

  const proposals: ProposalRecord[] = propDocs.map((docSnap) => {
    const d = docSnap.data();
    const isArchived = archivedProposalIds.has(docSnap.id);
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      proposalNumber: String(d.proposalNumber || ''),
      proposalDate: String(d.proposalDate || ''),
      fiscalYear: Number(d.fiscalYear) || new Date().getFullYear(),
      title: String(d.title || ''),
      categoryId: String(d.categoryId || ''),
      categoryName: String(d.categoryName || ''),
      templateId: '',
      proposalType: String(d.proposalType || ''),
      recipientName: String(d.recipientName || ''),
      recipientInstitution: String(d.recipientInstitution || ''),
      recipientAddress: '',
      location: String(d.location || ''),
      executionTime: String(d.executionTime || ''),
      summary: String(d.activityDescription || ''),
      sections: Array.isArray(d.sectionsContent) ? d.sectionsContent : [],
      attachmentIds: [],
      isArchived,
      archivedAt: isArchived ? timestampToIso(d.updatedAt) : '',
      status: (PROPOSAL_STATUS_ORDER.includes(d.status) ? d.status : 'Draft') as ProposalRecord['status'],
      totalBudget: Number(d.totalBudget) || 0,
      approvedAmount: Number(d.approvedAmount) || 0,
      receivedAmount: Number(d.receivedAmount) || 0,
      submittedAt: String(d.submittedAt || ''),
      approvedAt: '',
      rejectedReason: '',
      followUpNotes: String(d.followUpNotes || ''),
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
      createdBy: String(d.createdBy || ''),
      updatedBy: String(d.updatedBy || ''),
    };
  });

  const propTitleById = new Map<string, string>(proposals.map((p) => [p.id, p.title]));

  const budgets: ProposalBudget[] = budgetDocs.map((docSnap) => {
    const d = docSnap.data();
    const proposalId = String(d.proposalId || '');
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      proposalId,
      proposalTitle: propTitleById.get(proposalId) || '',
      title: String(d.workGroup || 'RAB Utama'),
      notes: '',
      items: Array.isArray(d.items) ? d.items : [],
      totalAmount: Number(d.totalAmount) || 0,
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
      createdBy: String(d.createdBy || ''),
      updatedBy: String(d.updatedBy || ''),
    };
  });

  const attachments: ProposalAttachment[] = attDocs.map((docSnap) => {
    const d = docSnap.data();
    const proposalId = String(d.proposalId || '');
    const mimeType = String(d.fileType || 'image/jpeg');
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      proposalId,
      proposalTitle: propTitleById.get(proposalId) || '',
      category: (d.category || 'Lainnya') as ProposalAttachment['category'],
      title: String(d.title || 'Lampiran'),
      description: '',
      fileUrl: String(d.fileUrl || ''),
      fileName: String(d.fileName || ''),
      mimeType,
      fileSize: 0,
      isImage: !mimeType.includes('pdf'),
      createdAt: timestampToIso(d.createdAt),
      updatedAt: timestampToIso(d.updatedAt),
      createdBy: String(d.createdBy || ''),
    };
  });

  const statusHistory: ProposalStatusHistory[] = histDocs.map((docSnap) => {
    const d = docSnap.data();
    const proposalId = String(d.proposalId || '');
    return {
      id: docSnap.id,
      institutionId: String(d.institutionId || INSTITUTION_DOC_ID),
      proposalId,
      proposalTitle: propTitleById.get(proposalId) || '',
      fromStatus: d.fromStatus ? (String(d.fromStatus) as ProposalStatusHistory['fromStatus']) : undefined,
      toStatus: (PROPOSAL_STATUS_ORDER.includes(d.toStatus)
        ? d.toStatus
        : 'Draft') as ProposalStatusHistory['toStatus'],
      notes: String(d.notes || ''),
      actorUid: String(d.createdBy || ''),
      actorName: 'Pengguna',
      createdAt: timestampToIso(d.createdAt),
    };
  });

  proposals.sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  );
  statusHistory.sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );

  return {
    institution,
    categories,
    templates,
    proposals,
    budgets,
    attachments,
    statusHistory,
    counts: {
      institutions: institution ? 1 : 0,
      categories: categories.length,
      templates: templates.length,
      proposals: proposals.length,
      budgets: budgets.length,
      attachments: attachments.length,
      archives: archiveDocs.length,
      statusHistory: statusHistory.length,
    },
  };
}

