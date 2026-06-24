"use client";

/**
 * Offline write queue — backs the service worker's Background Sync.
 *
 * When a save fails because the device is offline, the editor calls
 * `queueRequest(...)` to stash the request in IndexedDB with `pendingSync: true`
 * and asks for a Background Sync (`sync.register('sync-drafts')`). The service
 * worker (public/sw.js) replays the queue on the `sync` event — or the app can
 * call `flushQueuedRequests()` directly on the next `online` event for browsers
 * without Background Sync support.
 *
 * The IndexedDB store name/version/keyPath MUST match public/sw.js.
 */
const DB_NAME = "skimflow-offline";
const DB_VERSION = 1;
const STORE = "pending-requests";

export interface QueuedRequest {
  id?: number;
  url: string;
  method: string;
  body: string;
  label?: string; // human description, e.g. the draft title
  pendingSync: true;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

/** Queue an offline write and request a Background Sync to replay it. */
export async function queueRequest(input: { url: string; method: string; body: string; label?: string }): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({
      url: input.url,
      method: input.method,
      body: input.body,
      label: input.label,
      pendingSync: true,
      createdAt: Date.now(),
    } satisfies Omit<QueuedRequest, "id">);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await registerSync();
}

/** Ask the service worker to schedule a replay when connectivity returns. */
export async function registerSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    // Background Sync (Chromium). Falls back silently elsewhere — the 'online'
    // listener in ServiceWorkerRegister flushes for those browsers.
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
    if (sync) await sync.register("sync-drafts");
  } catch {
    /* no SW / no sync — flushQueuedRequests() on 'online' covers it */
  }
}

/** Number of writes still waiting to sync (for UI hints). */
export async function pendingCount(): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Replay queued writes from the page (fallback for browsers without Background
 * Sync, or to flush immediately on reconnect). Returns how many synced.
 */
export async function flushQueuedRequests(): Promise<number> {
  const db = await openDb();
  const all = await new Promise<QueuedRequest[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedRequest[]);
    req.onerror = () => reject(req.error);
  });

  let synced = 0;
  for (const r of all) {
    try {
      const res = await fetch(r.url, {
        method: r.method,
        headers: { "content-type": "application/json" },
        body: r.body,
        credentials: "same-origin",
      });
      if (res.ok && r.id != null) {
        await deleteRequest(r.id);
        synced++;
      }
    } catch {
      break; // still offline — stop and let the next online/sync retry
    }
  }
  return synced;
}

function deleteRequest(id: number): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
