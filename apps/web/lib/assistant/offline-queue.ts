/**
 * Offline send queue for the chat assistant.
 *
 * Construction sites have dead spots — when a send exhausts its retries on a
 * network failure, the input is parked here and re-sent automatically once
 * the connection returns. A failed send must never lose the text.
 *
 * Storage: localStorage key `datum.chat.queue.<projectId>` holding a JSON
 * array of QueuedItem, oldest first, capped at QUEUE_CAP (oldest dropped on
 * overflow). Pure functions, no React — ChatDock owns the actual re-sending.
 */

export type QueuedMode = "tanya" | "catat";

export type QueuedItem = {
  id: string;
  mode: QueuedMode;
  text: string;
  /** Epoch ms at the moment the item was queued. */
  ts: number;
};

export const QUEUE_CAP = 20;

/**
 * Tanya items older than this are dropped silently on drain — the answer to
 * a stale question is no longer wanted. Catat notes are NEVER dropped by age.
 */
export const TANYA_MAX_AGE_MS = 30 * 60 * 1000;

function storageKey(projectId: string): string {
  return `datum.chat.queue.${projectId}`;
}

function getStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null; // SSR or privacy mode where even the accessor throws
  }
}

function isQueuedItem(v: unknown): v is QueuedItem {
  if (typeof v !== "object" || v === null) return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.id === "string"
    && (i.mode === "tanya" || i.mode === "catat")
    && typeof i.text === "string"
    && typeof i.ts === "number"
  );
}

/** Current queue, oldest first. Corrupt/missing storage reads as empty. */
export function readQueue(projectId: string): QueuedItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(storageKey(projectId));
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isQueuedItem) : [];
  } catch {
    return [];
  }
}

function writeQueue(projectId: string, items: QueuedItem[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (items.length === 0) storage.removeItem(storageKey(projectId));
    else storage.setItem(storageKey(projectId), JSON.stringify(items));
  } catch { /* quota exceeded / private mode — non-fatal */ }
}

/**
 * Append an item, generating its id. Beyond QUEUE_CAP the oldest items are
 * dropped. Returns the stored item so callers can track it.
 */
export function enqueue(
  projectId: string,
  item: { mode: QueuedMode; text: string; ts: number },
): QueuedItem {
  const queued: QueuedItem = { id: crypto.randomUUID(), ...item };
  writeQueue(projectId, [...readQueue(projectId), queued].slice(-QUEUE_CAP));
  return queued;
}

/** Oldest queued item, if any. */
export function peek(projectId: string): QueuedItem | undefined {
  return readQueue(projectId)[0];
}

/** Remove one item by id. No-op when the id is absent. */
export function remove(projectId: string, id: string): void {
  const items = readQueue(projectId);
  const next = items.filter((i) => i.id !== id);
  if (next.length !== items.length) writeQueue(projectId, next);
}

/**
 * Returns the sendable items, oldest first, after silently dropping Tanya
 * items older than TANYA_MAX_AGE_MS (the pruned queue is persisted).
 *
 * Deliberately does NOT remove the returned items — the caller removes each
 * one via remove() only after its send succeeds, so a crash mid-send never
 * loses a note (the caller's in-flight guard handles double-send protection).
 */
export function drain(projectId: string, now: number = Date.now()): QueuedItem[] {
  const items = readQueue(projectId);
  const fresh = items.filter(
    (i) => i.mode === "catat" || now - i.ts <= TANYA_MAX_AGE_MS,
  );
  if (fresh.length !== items.length) writeQueue(projectId, fresh);
  return fresh;
}
