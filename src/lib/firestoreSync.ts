import { GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  enqueueFirestoreMutation,
  FirestoreSyncCollection,
  FirestoreSyncItem,
  getFirestoreSyncQueue,
  removeFirestoreSyncItem,
  updateFirestoreSyncItem,
} from './offlineDb';
import {
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

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  let snapExists = false;
  try {
    const snap = await getDoc(userRef);
    snapExists = snap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!snapExists) {
    const isBootstrap =
      (user.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
    try {
      await setDoc(userRef, {
        uid: sanitizeFirestoreId(user.uid, 'usr'),
        displayName: sanitizeString(user.displayName || user.email || 'Pengguna', 150) || 'Pengguna',
        email: sanitizeString(user.email || 'user@arraudhah.local', 200),
        photoURL: sanitizeOptionalUrl(user.photoURL, BLUEPRINT_LIMITS.user.photoURLMax),
        phone: '',
        position: isBootstrap ? 'Administrator Sistem' : 'Operator',
        role: isBootstrap ? 'Administrator' : 'Operator',
        status: isBootstrap ? 'active' : 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
        updatedBy: user.uid,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, userPath);
    }
  }

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
}): Promise<{ syncedCount: number; failedCount: number; lastError: string | null }> {
  if (firestoreSyncLock) {
    return { syncedCount: 0, failedCount: 0, lastError: null };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      syncedCount: 0,
      failedCount: 0,
      lastError: 'Perangkat masih offline. Perubahan menunggu koneksi internet.',
    };
  }
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    return {
      syncedCount: 0,
      failedCount: 0,
      lastError: 'Akun Google Firestore belum terhubung.',
    };
  }

  const queue = await getFirestoreSyncQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, failedCount: 0, lastError: null };
  }

  firestoreSyncLock = true;
  let syncedCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;

  try {
    const connected = await testConnection();
    if (!connected) {
      return {
        syncedCount: 0,
        failedCount: 0,
        lastError: 'Koneksi ke Firestore belum siap. Mencoba ulang saat online.',
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
      } catch (err) {
        failedCount += 1;
        lastError = formatFirestoreErrorForDisplay(err);
        await updateFirestoreSyncItem(item.id, {
          status: 'failed',
          retryCount: (item.retryCount || 0) + 1,
          lastError,
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

  return { syncedCount, failedCount, lastError };
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
  collection: FirestoreSyncCollection,
  docId: string,
  operation: 'upsert' | 'delete',
  payload: Record<string, unknown>,
  label: string
): Promise<void> {
  await enqueueFirestoreMutation({
    collection,
    docId: sanitizeFirestoreId(docId, collection.slice(0, 4)),
    operation,
    payload,
    label,
  });
}
