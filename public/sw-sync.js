/* eslint-disable no-restricted-globals */
/**
 * Service Worker Background Sync handler for AR-RAUDHAH Proposal Management System.
 * Imported by the Workbox-generated Service Worker via workbox.importScripts.
 */

const OFFLINE_DB_NAME = 'arraudhah_offline_db';
const OFFLINE_DB_VERSION = 2;
const SYNC_TAG_MAIN = 'arraudhah-sync-queue';

function swOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('offlineAuth')) {
        db.createObjectStore('offlineAuth', { keyPath: 'usernameKey' });
      }
      if (!db.objectStoreNames.contains('kvStore')) {
        db.createObjectStore('kvStore', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('firestoreQueue')) {
        db.createObjectStore('firestoreQueue', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function swGetKv(db, key) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('kvStore', 'readonly');
      const req = tx.objectStore('kvStore').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function swGetAllQueue(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

function swDeleteItem(db, storeName, id) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function replayServerMutationQueue() {
  let syncedCount = 0;
  try {
    const db = await swOpenDb();
    const token = await swGetKv(db, 'swSyncToken');
    const rawQueue = await swGetAllQueue(db, 'syncQueue');

    if (token && Array.isArray(rawQueue) && rawQueue.length > 0) {
      const sorted = [...rawQueue].sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      );
      for (const item of sorted) {
        try {
          const res = await fetch(item.endpoint, {
            method: item.method || 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body:
              item.method === 'DELETE'
                ? undefined
                : JSON.stringify(item.body || {}),
          });

          if (res.ok || (res.status === 404 && item.method === 'DELETE')) {
            await swDeleteItem(db, 'syncQueue', item.id);
            syncedCount += 1;
          } else if (res.status === 401 || res.status >= 500) {
            break;
          }
        } catch {
          // Network still unavailable — throw so Background Sync retries with backoff
          throw new Error('Network unavailable during background sync');
        }
      }
    }
  } catch {
    // Allow client notification below even if server queue replay deferred
  }

  // Notify any open window clients to flush Firestore SDK queue & refresh state
  try {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of windowClients) {
      client.postMessage({
        type: 'BACKGROUND_SYNC_TRIGGER',
        syncedInSwCount: syncedCount,
      });
    }
  } catch {
    // Ignore client messaging errors
  }

  return syncedCount;
}

self.addEventListener('sync', (event) => {
  if (
    event.tag === SYNC_TAG_MAIN ||
    event.tag === 'arraudhah-firestore-sync'
  ) {
    event.waitUntil(replayServerMutationQueue());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'REQUEST_BACKGROUND_SYNC') {
    event.waitUntil(replayServerMutationQueue());
  }
});
