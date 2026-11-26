import { AppUser, InstitutionProfile, ProposalCategory, ProposalRecord } from '../types/models';

const DB_NAME = 'arraudhah_offline_db';
const DB_VERSION = 1;

interface OfflineAuthRecord {
  usernameKey: string;
  saltHex: string;
  hashHex: string;
  recoverySaltHex?: string;
  recoveryHashHex?: string;
  user: AppUser;
  updatedAt: string;
}

export interface OfflineSyncMutation {
  id: string;
  endpoint: string;
  method: 'PUT' | 'PATCH' | 'POST' | 'DELETE';
  body: Record<string, unknown>;
  createdAt: string;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('offlineAuth')) {
        db.createObjectStore('offlineAuth', { keyPath: 'usernameKey' });
      }
      if (!db.objectStoreNames.contains('kvStore')) {
        db.createObjectStore('kvStore', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function derivePbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(derived));
}

async function verifyPbkdf2(
  secret: string,
  saltHex?: string,
  hashHex?: string
): Promise<boolean> {
  if (!saltHex || !hashHex || typeof crypto === 'undefined' || !crypto.subtle) {
    return false;
  }
  const candidateHash = await derivePbkdf2(secret, fromHex(saltHex));
  if (candidateHash.length !== hashHex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

export async function cacheOfflineAuthCredential(
  username: string,
  password: string,
  user: AppUser,
  recoveryCode?: string
): Promise<void> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) return;
  const usernameKey = username.trim().toLowerCase();
  const db = await openOfflineDb();

  const existing = await new Promise<OfflineAuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').get(usernameKey);
    req.onsuccess = () => resolve(req.result as OfflineAuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await derivePbkdf2(password, salt);

  let recoverySaltHex = existing?.recoverySaltHex;
  let recoveryHashHex = existing?.recoveryHashHex;
  if (recoveryCode && recoveryCode.trim().length >= 4) {
    const recSalt = crypto.getRandomValues(new Uint8Array(16));
    recoverySaltHex = toHex(recSalt);
    recoveryHashHex = await derivePbkdf2(recoveryCode.trim(), recSalt);
  }

  const record: OfflineAuthRecord = {
    usernameKey,
    saltHex: toHex(salt),
    hashHex,
    ...(recoverySaltHex && recoveryHashHex ? { recoverySaltHex, recoveryHashHex } : {}),
    user: {
      ...user,
      hasRecoveryCode: Boolean(user.hasRecoveryCode || recoveryHashHex),
    },
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readwrite');
    tx.objectStore('offlineAuth').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type OfflineVerifyResult =
  | { status: 'ok'; user: AppUser }
  | { status: 'wrong_password' }
  | { status: 'not_found' };

export async function verifyOfflineAuthCredentialDetailed(
  username: string,
  password: string
): Promise<OfflineVerifyResult> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) {
    return { status: 'not_found' };
  }
  const db = await openOfflineDb();
  const record = await new Promise<OfflineAuthRecord | undefined>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').get(username.trim().toLowerCase());
    req.onsuccess = () => resolve(req.result as OfflineAuthRecord | undefined);
    req.onerror = () => reject(req.error);
  });

  if (!record) return { status: 'not_found' };
  const candidateHash = await derivePbkdf2(password, fromHex(record.saltHex));
  if (candidateHash.length !== record.hashHex.length) {
    return { status: 'wrong_password' };
  }
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash.charCodeAt(i) ^ record.hashHex.charCodeAt(i);
  }
  return diff === 0 ? { status: 'ok', user: record.user } : { status: 'wrong_password' };
}

export async function verifyOfflineAuthCredential(
  username: string,
  password: string
): Promise<AppUser | null> {
  const result = await verifyOfflineAuthCredentialDetailed(username, password);
  return result.status === 'ok' ? result.user : null;
}

export async function hasOfflineUsername(username: string): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const db = await openOfflineDb();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').get(username.trim().toLowerCase());
    req.onsuccess = () => resolve(Boolean(req.result));
    req.onerror = () => reject(req.error);
  });
}

export async function hasAnyOfflineAccount(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const db = await openOfflineDb();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').count();
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllOfflineUsers(): Promise<AppUser[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openOfflineDb();
  return new Promise<AppUser[]>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').getAll();
    req.onsuccess = () => {
      const rows = (req.result as OfflineAuthRecord[]) || [];
      resolve(rows.map((r) => r.user));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateOfflineAuthUserMetadata(
  uid: string,
  updates: Partial<AppUser>,
  newPassword?: string,
  newRecoveryCode?: string
): Promise<AppUser | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openOfflineDb();
  const rows = await new Promise<OfflineAuthRecord[]>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').getAll();
    req.onsuccess = () => resolve((req.result as OfflineAuthRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  const target = rows.find((r) => r.user.uid === uid);
  if (!target) return null;

  const nextUsername =
    typeof updates.username === 'string' && updates.username.trim()
      ? updates.username.trim()
      : target.user.username || target.usernameKey;
  const nextUsernameKey = nextUsername.toLowerCase();

  if (
    nextUsernameKey !== target.usernameKey &&
    rows.some((r) => r.user.uid !== uid && r.usernameKey === nextUsernameKey)
  ) {
    throw new Error('Nama pengguna tersebut sudah digunakan akun lain.');
  }

  let saltHex = target.saltHex;
  let hashHex = target.hashHex;
  if (newPassword && newPassword.length >= 6 && crypto?.subtle) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltHex = toHex(salt);
    hashHex = await derivePbkdf2(newPassword, salt);
  }

  let recoverySaltHex = target.recoverySaltHex;
  let recoveryHashHex = target.recoveryHashHex;
  if (newRecoveryCode && newRecoveryCode.trim().length >= 4 && crypto?.subtle) {
    const recSalt = crypto.getRandomValues(new Uint8Array(16));
    recoverySaltHex = toHex(recSalt);
    recoveryHashHex = await derivePbkdf2(newRecoveryCode.trim(), recSalt);
  }

  const nextUser: AppUser = {
    ...target.user,
    ...updates,
    username: nextUsername,
    hasRecoveryCode: Boolean(updates.hasRecoveryCode || recoveryHashHex),
    updatedAt: new Date().toISOString(),
  };

  const nextRecord: OfflineAuthRecord = {
    ...target,
    usernameKey: nextUsernameKey,
    saltHex,
    hashHex,
    ...(recoverySaltHex && recoveryHashHex ? { recoverySaltHex, recoveryHashHex } : {}),
    user: nextUser,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readwrite');
    const store = tx.objectStore('offlineAuth');
    if (nextUsernameKey !== target.usernameKey) {
      store.delete(target.usernameKey);
    }
    store.put(nextRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return nextUser;
}

export async function recoverOfflineUsername(
  displayName: string,
  secret: string
): Promise<{ username: string; displayName: string } | null> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) return null;
  const db = await openOfflineDb();
  const rows = await new Promise<OfflineAuthRecord[]>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').getAll();
    req.onsuccess = () => resolve((req.result as OfflineAuthRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  const cleanName = displayName.trim().toLowerCase();
  const candidates = rows.filter(
    (r) => (r.user.displayName || '').trim().toLowerCase() === cleanName
  );

  for (const cand of candidates) {
    const passMatch = await verifyPbkdf2(secret, cand.saltHex, cand.hashHex);
    const recMatch = await verifyPbkdf2(
      secret.trim(),
      cand.recoverySaltHex,
      cand.recoveryHashHex
    );
    if (passMatch || recMatch) {
      return {
        username: cand.user.username || cand.usernameKey,
        displayName: cand.user.displayName,
      };
    }
  }
  return null;
}

export async function resetOfflineAccount(
  identifier: string,
  recoveryCode: string,
  newUsername: string,
  newPassword: string
): Promise<{ username: string }> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) {
    throw new Error('Penyimpanan lokal tidak tersedia pada peramban ini.');
  }
  const db = await openOfflineDb();
  const rows = await new Promise<OfflineAuthRecord[]>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').getAll();
    req.onsuccess = () => resolve((req.result as OfflineAuthRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  const lowered = identifier.trim().toLowerCase();
  const target =
    rows.find((r) => (r.user.username || r.usernameKey).toLowerCase() === lowered) ||
    (() => {
      const byDisplay = rows.filter(
        (r) => (r.user.displayName || '').trim().toLowerCase() === lowered
      );
      return byDisplay.length === 1 ? byDisplay[0] : undefined;
    })();

  if (!target) {
    throw new Error('Akun tidak ditemukan pada penyimpanan lokal perangkat ini.');
  }

  const validRecovery = await verifyPbkdf2(
    recoveryCode.trim(),
    target.recoverySaltHex,
    target.recoveryHashHex
  );
  if (!validRecovery) {
    throw new Error(
      'Kode pemulihan tidak sesuai atau belum diatur pada akun ini.'
    );
  }

  const updated = await updateOfflineAuthUserMetadata(
    target.user.uid,
    {
      username: newUsername.trim() || target.user.username || target.usernameKey,
    },
    newPassword
  );
  if (!updated) {
    throw new Error('Gagal memperbarui akun.');
  }
  return { username: updated.username || target.usernameKey };
}

export async function clearAllOfflineAuthAccounts(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['offlineAuth', 'kvStore'], 'readwrite');
    tx.objectStore('offlineAuth').clear();
    tx.objectStore('kvStore').delete('users');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteOfflineAuthUser(uid: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  const rows = await new Promise<OfflineAuthRecord[]>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readonly');
    const req = tx.objectStore('offlineAuth').getAll();
    req.onsuccess = () => resolve((req.result as OfflineAuthRecord[]) || []);
    req.onerror = () => reject(req.error);
  });

  const target = rows.find((r) => r.user.uid === uid);
  if (!target) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('offlineAuth', 'readwrite');
    tx.objectStore('offlineAuth').delete(target.usernameKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function setOfflineKV<T>(key: string, value: T): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kvStore', 'readwrite');
    tx.objectStore('kvStore').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineKV<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openOfflineDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction('kvStore', 'readonly');
    const req = tx.objectStore('kvStore').get(key);
    req.onsuccess = () => {
      const row = req.result as { key: string; value: T } | undefined;
      resolve(row ? row.value : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function cacheDashboardSnapshot(data: {
  institution: InstitutionProfile;
  proposals: ProposalRecord[];
  categories: ProposalCategory[];
}): Promise<void> {
  await setOfflineKV('institution', data.institution);
  await setOfflineKV('proposals', data.proposals);
  await setOfflineKV('categories', data.categories);
}

export async function enqueueOfflineMutation(
  mutation: Omit<OfflineSyncMutation, 'id' | 'createdAt'>
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  const existingQueue = await getOfflineMutationQueue();
  const entry: OfflineSyncMutation = {
    ...mutation,
    id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    for (const old of existingQueue) {
      if (old.endpoint === mutation.endpoint && old.method === mutation.method) {
        store.delete(old.id);
      }
    }
    store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineMutationQueue(): Promise<OfflineSyncMutation[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openOfflineDb();
  return new Promise<OfflineSyncMutation[]>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readonly');
    const req = tx.objectStore('syncQueue').getAll();
    req.onsuccess = () => resolve((req.result as OfflineSyncMutation[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineMutation(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    tx.objectStore('syncQueue').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
