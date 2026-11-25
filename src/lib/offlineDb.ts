import { AppUser, InstitutionProfile, ProposalCategory, ProposalRecord } from '../types/models';

const DB_NAME = 'arraudhah_offline_db';
const DB_VERSION = 1;

interface OfflineAuthRecord {
  usernameKey: string;
  saltHex: string;
  hashHex: string;
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

export async function cacheOfflineAuthCredential(
  username: string,
  password: string,
  user: AppUser
): Promise<void> {
  if (typeof indexedDB === 'undefined' || !crypto?.subtle) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await derivePbkdf2(password, salt);
  const record: OfflineAuthRecord = {
    usernameKey: username.trim().toLowerCase(),
    saltHex: toHex(salt),
    hashHex,
    user,
    updatedAt: new Date().toISOString(),
  };

  const db = await openOfflineDb();
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
  const entry: OfflineSyncMutation = {
    ...mutation,
    id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    tx.objectStore('syncQueue').put(entry);
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
