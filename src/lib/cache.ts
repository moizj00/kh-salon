import { captureUserId } from "./outbox";
import { newKey, openJson, sealJson } from "./outbox/crypto";

// Encrypted offline read cache (P1-09, Task 7)
// Provides cachedRows<T>(key, loadFn) network-first with sealed IndexedDB fallback.

const CACHE_DB = "kiran-cache";
const CACHE_STORE = "sealed_cache";
const CACHE_KEYS = "cache_keys";

type CacheEntry = {
  key: string;
  userId: string;
  sealed: string;
  savedAt: string;
};

const keyCache = new Map<string, CryptoKey>();

let dbPromise: Promise<IDBDatabase> | null = null;

const getCacheDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(CACHE_KEYS)) {
        db.createObjectStore(CACHE_KEYS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open cache DB."));
  });
  return dbPromise;
};

const getCacheKey = async (db: IDBDatabase, userId: string): Promise<CryptoKey> => {
  const cached = keyCache.get(userId);
  if (cached) return cached;

  const tx = db.transaction(CACHE_KEYS, "readwrite");
  const store = tx.objectStore(CACHE_KEYS);

  const existing = await new Promise<CryptoKey | undefined>((resolve) => {
    const req = store.get(userId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });

  if (existing) {
    keyCache.set(userId, existing);
    return existing;
  }

  const fresh = await newKey();
  store.put(fresh, userId);
  keyCache.set(userId, fresh);
  return fresh;
};

/**
 * Loads data network-first. On success, seals and caches locally.
 * On network/transient failure, decrypts and returns previously cached rows.
 */
export async function cachedRows<T>(
  cacheKey: string,
  load: () => Promise<T[]>,
): Promise<{ rows: T[]; fromCache: boolean; savedAt: string | null }> {
  const userId = await captureUserId();
  const fullKey = `${userId}:${cacheKey}`;

  try {
    const freshRows = await load();

    // Seal and persist in the background
    void (async () => {
      try {
        const db = await getCacheDb();
        const key = await getCacheKey(db, userId);
        const sealed = await sealJson(key, freshRows);
        const tx = db.transaction(CACHE_STORE, "readwrite");
        tx.objectStore(CACHE_STORE).put({
          key: fullKey,
          userId,
          sealed,
          savedAt: new Date().toISOString(),
        } satisfies CacheEntry);
      } catch (e) {
        console.warn("Failed to update offline read cache:", e);
      }
    })();

    return { rows: freshRows, fromCache: false, savedAt: null };
  } catch (err) {
    // Attempt fallback from encrypted cache
    try {
      const db = await getCacheDb();
      const tx = db.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);

      const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
        const req = store.get(fullKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (entry) {
        const key = await getCacheKey(db, userId);
        const rows = await openJson<T[]>(key, entry.sealed);
        return { rows, fromCache: true, savedAt: entry.savedAt };
      }
    } catch (cacheErr) {
      console.warn("Failed to read from offline cache:", cacheErr);
    }

    throw err;
  }
}
