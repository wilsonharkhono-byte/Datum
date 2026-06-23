/**
 * Offline send queue for the DATUM assistant.
 *
 * Construction sites have dead spots — when a send exhausts its retries on a
 * network failure, the input is parked here and re-sent automatically once
 * the connection returns. A failed send must never lose the text.
 *
 * Storage is abstracted behind QueueStorage (injected by the caller):
 *   - Web:    inject a thin localStorage-backed adapter
 *   - Mobile: inject an AsyncStorage-backed adapter
 *
 * Pure functions — no React, no Next.js, no globals.
 * Moved/adapted from apps/web/lib/assistant/offline-queue.ts.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueuedMode = "tanya" | "catat";

export type QueuedItem = {
  id: string;
  mode: QueuedMode;
  text: string;
  /** Epoch ms at the moment the item was queued. */
  ts: number;
};

/**
 * Injected storage interface — compatible with both synchronous localStorage
 * and asynchronous AsyncStorage. All functions accept a Promise or direct value.
 */
export interface QueueStorage {
  getItem(k: string): string | null | Promise<string | null>;
  setItem(k: string, v: string): void | Promise<void>;
  removeItem(k: string): void | Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUEUE_CAP = 20;

/**
 * Tanya items older than this are dropped silently on drain — the answer to
 * a stale question is no longer wanted. Catat notes are NEVER dropped by age.
 */
export const TANYA_MAX_AGE_MS = 30 * 60 * 1000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function storageKey(projectId: string): string {
  return `datum.chat.queue.${projectId}`;
}

function isQueuedItem(v: unknown): v is QueuedItem {
  if (typeof v !== "object" || v === null) return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.id === "string" &&
    (i.mode === "tanya" || i.mode === "catat") &&
    typeof i.text === "string" &&
    typeof i.ts === "number"
  );
}

async function readRaw(storage: QueueStorage, projectId: string): Promise<QueuedItem[]> {
  try {
    const raw = await storage.getItem(storageKey(projectId));
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isQueuedItem) : [];
  } catch {
    return [];
  }
}

async function writeRaw(storage: QueueStorage, projectId: string, items: QueuedItem[]): Promise<void> {
  try {
    if (items.length === 0) {
      await storage.removeItem(storageKey(projectId));
    } else {
      await storage.setItem(storageKey(projectId), JSON.stringify(items));
    }
  } catch {
    // quota exceeded / private mode — non-fatal
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Current queue, oldest first. Corrupt/missing storage reads as empty. */
export async function readQueue(storage: QueueStorage, projectId: string): Promise<QueuedItem[]> {
  return readRaw(storage, projectId);
}

/**
 * Append an item, generating its id via an injected id generator.
 * Beyond QUEUE_CAP the oldest items are dropped.
 * Returns the stored item so callers can track it.
 *
 * @param genId  Returns a unique string id. Web injects a UUID v4 generator;
 *               mobile injects the equivalent from the expo crypto package.
 */
export async function enqueue(
  storage: QueueStorage,
  projectId: string,
  item: { mode: QueuedMode; text: string; ts: number },
  genId: () => string,
): Promise<QueuedItem> {
  const queued: QueuedItem = { id: genId(), ...item };
  const existing = await readRaw(storage, projectId);
  await writeRaw(storage, projectId, [...existing, queued].slice(-QUEUE_CAP));
  return queued;
}

/** Oldest queued item, if any. */
export async function peek(storage: QueueStorage, projectId: string): Promise<QueuedItem | undefined> {
  const items = await readRaw(storage, projectId);
  return items[0];
}

/** Remove one item by id. No-op when the id is absent. */
export async function remove(storage: QueueStorage, projectId: string, id: string): Promise<void> {
  const items = await readRaw(storage, projectId);
  const next = items.filter((i) => i.id !== id);
  if (next.length !== items.length) {
    await writeRaw(storage, projectId, next);
  }
}

/**
 * Returns the sendable items, oldest first, after silently dropping Tanya
 * items older than TANYA_MAX_AGE_MS (the pruned queue is persisted).
 *
 * Deliberately does NOT remove the returned items — the caller removes each
 * one via remove() only after its send succeeds, so a crash mid-send never
 * loses a note (the caller's in-flight guard handles double-send protection).
 */
export async function drain(
  storage: QueueStorage,
  projectId: string,
  now: number = Date.now(),
): Promise<QueuedItem[]> {
  const items = await readRaw(storage, projectId);
  const fresh = items.filter(
    (i) => i.mode === "catat" || now - i.ts <= TANYA_MAX_AGE_MS,
  );
  if (fresh.length !== items.length) {
    await writeRaw(storage, projectId, fresh);
  }
  return fresh;
}
