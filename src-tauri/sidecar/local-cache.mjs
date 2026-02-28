/**
 * Local persistent TTL cache for the desktop sidecar.
 * Zero external dependencies — uses only Node.js stdlib.
 *
 * Features:
 * - In-memory Map with TTL expiry
 * - LRU eviction when maxEntries exceeded
 * - File-backed persistence (survives sidecar restarts)
 * - Periodic flush + flush on SIGTERM/process.exit
 *
 * Usage:
 *   const cache = createLocalCache({ persistPath: '/path/cache.json', maxEntries: 500 });
 *   cache.set('key', { data: 1 }, 120); // TTL 120 seconds
 *   const val = cache.get('key');        // null if expired/missing
 *   cache.stop();
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const PERSIST_INTERVAL_MS = 60_000;

export function createLocalCache({ persistPath = null, maxEntries = 500 } = {}) {
  // Map<key, { value, expiresAt, lastAccess }>
  const store = new Map();
  let persistTimer = null;

  // ---- Load from file on startup ----
  if (persistPath) {
    try {
      const raw = readFileSync(persistPath, 'utf-8');
      const entries = JSON.parse(raw);
      const now = Date.now();
      if (Array.isArray(entries)) {
        for (const [key, entry] of entries) {
          if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > now) {
            store.set(key, { value: entry.value, expiresAt: entry.expiresAt, lastAccess: entry.lastAccess || now });
          }
        }
      }
    } catch { /* file missing or corrupt — start empty */ }
  }

  // ---- Helpers ----

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }

  function evictLRU() {
    if (store.size <= maxEntries) return;
    // Sort by lastAccess ascending (oldest first) and delete the excess
    const entries = Array.from(store.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const deleteCount = store.size - maxEntries;
    for (let i = 0; i < deleteCount; i++) {
      store.delete(entries[i][0]);
    }
  }

  function persist() {
    if (!persistPath) return;
    try {
      evictExpired();
      const serializable = Array.from(store.entries());
      const tmpPath = persistPath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(serializable), 'utf-8');
      renameSync(tmpPath, persistPath); // atomic on POSIX same-FS
    } catch { /* best-effort */ }
  }

  // ---- Schedule periodic persistence ----
  if (persistPath) {
    persistTimer = setInterval(persist, PERSIST_INTERVAL_MS);
    if (persistTimer.unref) persistTimer.unref(); // Don't block process exit

    process.once('SIGTERM', () => { persist(); });
    process.once('exit', () => { persist(); });
  }

  // ---- Public API ----

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      entry.lastAccess = Date.now();
      return entry.value;
    },

    set(key, value, ttlSeconds) {
      const expiresAt = Date.now() + (ttlSeconds * 1000);
      store.set(key, { value, expiresAt, lastAccess: Date.now() });
      evictExpired();
      evictLRU();
    },

    delete(key) {
      store.delete(key);
    },

    size() {
      evictExpired();
      return store.size;
    },

    persist,

    stop() {
      if (persistTimer) clearInterval(persistTimer);
      persist();
    },
  };
}
