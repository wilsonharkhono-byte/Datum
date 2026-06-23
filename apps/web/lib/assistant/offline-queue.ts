/**
 * Thin adapter — routes web offline-queue through @datum/core.
 *
 * Defines a localStorage-backed QueueStorage and a crypto.randomUUID genId,
 * then re-exports web-friendly wrappers with the same names ChatDock imports.
 * All functions are now async (returning Promises) because core's queue is
 * async over the injected storage interface.
 *
 * Storage: localStorage key `datum.chat.queue.<projectId>` holding a JSON
 * array of QueuedItem, oldest first, capped at QUEUE_CAP. Pure functions,
 * no React — ChatDock owns the actual re-sending.
 */

import {
  readQueue as coreReadQueue,
  enqueue as coreEnqueue,
  peek as corePeek,
  remove as coreRemove,
  drain as coreDrain,
  type QueueStorage,
} from "@datum/core";

// Re-export types + constants so callers don't need a separate import.
export type { QueuedItem, QueuedMode } from "@datum/core";
export { QUEUE_CAP, TANYA_MAX_AGE_MS } from "@datum/core";

// ─── localStorage adapter ─────────────────────────────────────────────────────

/**
 * Returns a QueueStorage backed by window.localStorage, or a no-op shim in
 * SSR / private-mode environments where localStorage is unavailable.
 */
function makeStorage(): QueueStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return noopStorage();
    return {
      getItem: (k) => Promise.resolve(ls.getItem(k)),
      setItem: (k, v) => Promise.resolve(ls.setItem(k, v)),
      removeItem: (k) => Promise.resolve(ls.removeItem(k)),
    };
  } catch {
    return noopStorage();
  }
}

function noopStorage(): QueueStorage {
  return {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  };
}

const genId = () => crypto.randomUUID();

// ─── Web-friendly wrappers ────────────────────────────────────────────────────

/** Current queue, oldest first. Corrupt/missing storage reads as empty. */
export function readQueue(projectId: string) {
  return coreReadQueue(makeStorage(), projectId);
}

/**
 * Append an item. Beyond QUEUE_CAP the oldest items are dropped.
 * Returns the stored item so callers can track it.
 */
export function enqueue(
  projectId: string,
  item: { mode: "tanya" | "catat"; text: string; ts: number },
) {
  return coreEnqueue(makeStorage(), projectId, item, genId);
}

/** Oldest queued item, if any. */
export function peek(projectId: string) {
  return corePeek(makeStorage(), projectId);
}

/** Remove one item by id. No-op when the id is absent. */
export function remove(projectId: string, id: string) {
  return coreRemove(makeStorage(), projectId, id);
}

/**
 * Returns the sendable items, oldest first, after silently dropping Tanya
 * items older than TANYA_MAX_AGE_MS (the pruned queue is persisted).
 *
 * Deliberately does NOT remove the returned items — the caller removes each
 * one via remove() only after its send succeeds.
 */
export function drain(projectId: string, now: number = Date.now()) {
  return coreDrain(makeStorage(), projectId, now);
}
