import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import defaultFirebaseConfig from '../../firebase-applet-config.json';

function pickEnv(envVal: unknown, fallback: string): string {
  return typeof envVal === 'string' && envVal.trim().length > 0 ? envVal.trim() : fallback;
}

const firebaseConfig = {
  ...defaultFirebaseConfig,
  apiKey: pickEnv(import.meta.env.VITE_FIREBASE_API_KEY, defaultFirebaseConfig.apiKey),
  authDomain: pickEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, defaultFirebaseConfig.authDomain),
  projectId: pickEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID, defaultFirebaseConfig.projectId),
  storageBucket: pickEnv(
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    defaultFirebaseConfig.storageBucket
  ),
  messagingSenderId: pickEnv(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    defaultFirebaseConfig.messagingSenderId
  ),
  appId: pickEnv(import.meta.env.VITE_FIREBASE_APP_ID, defaultFirebaseConfig.appId),
  firestoreDatabaseId: pickEnv(
    import.meta.env.VITE_FIREBASE_DATABASE_ID,
    defaultFirebaseConfig.firestoreDatabaseId
  ),
};

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  },
  firebaseConfig.firestoreDatabaseId
);
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {});
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return false;
    }
    return true;
  }
}
