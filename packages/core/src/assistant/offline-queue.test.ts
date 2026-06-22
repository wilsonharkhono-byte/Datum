import { beforeEach, describe, expect, it } from "vitest";
import {
  drain,
  enqueue,
  peek,
  readQueue,
  remove,
  QUEUE_CAP,
  TANYA_MAX_AGE_MS,
  type QueueStorage,
} from "./offline-queue";

// ─── In-memory storage adapter ────────────────────────────────────────────────

function memStorage(): QueueStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

let storage: ReturnType<typeof memStorage>;
const genId = (() => { let i = 0; return () => `id-${++i}`; })();

beforeEach(() => {
  storage = memStorage();
});

const NOW = 1_750_000_000_000;

// ─── enqueue / readQueue ──────────────────────────────────────────────────────

describe("offline-queue enqueue/read", () => {
  it("round-trips an item with a generated id under the per-project key", async () => {
    const item = await enqueue(storage, "p1", { mode: "catat", text: "Cek besi kolom lantai 2", ts: NOW }, genId);
    expect(item.id).toMatch(/^id-\d+$/);
    expect(storage.store.has("datum.chat.queue.p1")).toBe(true);
    expect(await readQueue(storage, "p1")).toEqual([item]);
  });

  it("keeps items oldest first and isolates projects", async () => {
    const a = await enqueue(storage, "p1", { mode: "catat", text: "satu", ts: NOW }, genId);
    const b = await enqueue(storage, "p1", { mode: "tanya", text: "dua", ts: NOW + 1 }, genId);
    await enqueue(storage, "p2", { mode: "catat", text: "lain proyek", ts: NOW }, genId);
    expect((await readQueue(storage, "p1")).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(await readQueue(storage, "p2")).toHaveLength(1);
  });

  it("reads corrupt or non-array storage as empty", async () => {
    await storage.setItem("datum.chat.queue.p1", "{not json");
    expect(await readQueue(storage, "p1")).toEqual([]);
    await storage.setItem("datum.chat.queue.p1", JSON.stringify({ nope: true }));
    expect(await readQueue(storage, "p1")).toEqual([]);
  });

  it("filters malformed entries but keeps valid ones", async () => {
    const good = { id: "x", mode: "catat" as const, text: "valid", ts: NOW };
    await storage.setItem("datum.chat.queue.p1", JSON.stringify([good, { mode: "catat" }, 42]));
    expect(await readQueue(storage, "p1")).toEqual([good]);
  });

  it("caps the queue at QUEUE_CAP, dropping the oldest items", async () => {
    const ids: string[] = [];
    for (let i = 0; i < QUEUE_CAP + 5; i++) {
      ids.push((await enqueue(storage, "p1", { mode: "catat", text: `note ${i}`, ts: NOW + i }, genId)).id);
    }
    const queued = await readQueue(storage, "p1");
    expect(queued).toHaveLength(QUEUE_CAP);
    expect(queued.map((i) => i.id)).toEqual(ids.slice(5));
  });
});

// ─── peek / remove ────────────────────────────────────────────────────────────

describe("offline-queue peek/remove", () => {
  it("peek returns the oldest item without removing it", async () => {
    const a = await enqueue(storage, "p1", { mode: "catat", text: "pertama", ts: NOW }, genId);
    await enqueue(storage, "p1", { mode: "catat", text: "kedua", ts: NOW + 1 }, genId);
    expect(await peek(storage, "p1")).toEqual(a);
    expect(await readQueue(storage, "p1")).toHaveLength(2);
    expect(await peek(storage, "kosong")).toBeUndefined();
  });

  it("remove deletes exactly one item by id and is a no-op for unknown ids", async () => {
    const a = await enqueue(storage, "p1", { mode: "catat", text: "satu", ts: NOW }, genId);
    const b = await enqueue(storage, "p1", { mode: "catat", text: "dua", ts: NOW + 1 }, genId);
    await remove(storage, "p1", a.id);
    expect(await readQueue(storage, "p1")).toEqual([b]);
    await remove(storage, "p1", "bukan-id");
    expect(await readQueue(storage, "p1")).toEqual([b]);
  });

  it("removing the last item clears the storage key", async () => {
    const a = await enqueue(storage, "p1", { mode: "catat", text: "satu", ts: NOW }, genId);
    await remove(storage, "p1", a.id);
    expect(storage.store.has("datum.chat.queue.p1")).toBe(false);
  });
});

// ─── drain ────────────────────────────────────────────────────────────────────

describe("offline-queue drain", () => {
  it("returns items oldest first WITHOUT removing them", async () => {
    const a = await enqueue(storage, "p1", { mode: "catat", text: "satu", ts: NOW - 1000 }, genId);
    const b = await enqueue(storage, "p1", { mode: "tanya", text: "dua", ts: NOW }, genId);
    expect((await drain(storage, "p1", NOW)).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(await readQueue(storage, "p1")).toHaveLength(2);
  });

  it("silently drops Tanya items older than 30 minutes and persists the prune", async () => {
    const stale = await enqueue(storage, "p1", { mode: "tanya", text: "basi", ts: NOW - TANYA_MAX_AGE_MS - 1 }, genId);
    const fresh = await enqueue(storage, "p1", { mode: "tanya", text: "segar", ts: NOW - TANYA_MAX_AGE_MS }, genId);
    const drained = await drain(storage, "p1", NOW);
    expect(drained.map((i) => i.id)).toEqual([fresh.id]);
    expect((await readQueue(storage, "p1")).map((i) => i.id)).toEqual([fresh.id]);
    expect((await readQueue(storage, "p1")).some((i) => i.id === stale.id)).toBe(false);
  });

  it("never drops Catat notes regardless of age", async () => {
    const old = await enqueue(storage, "p1", { mode: "catat", text: "catatan lama", ts: NOW - 7 * 24 * 60 * 60 * 1000 }, genId);
    expect((await drain(storage, "p1", NOW)).map((i) => i.id)).toEqual([old.id]);
    expect(await readQueue(storage, "p1")).toHaveLength(1);
  });

  it("returns empty for an empty queue", async () => {
    expect(await drain(storage, "p1", NOW)).toEqual([]);
  });
});

// ─── async storage adapter ────────────────────────────────────────────────────

describe("offline-queue with async storage adapter", () => {
  it("works when storage methods return Promises", async () => {
    const asyncStore = new Map<string, string>();
    const asyncStorage: QueueStorage = {
      getItem: (k: string) => Promise.resolve(asyncStore.get(k) ?? null),
      setItem: (k: string, v: string) => Promise.resolve(void asyncStore.set(k, v)),
      removeItem: (k: string) => Promise.resolve(void asyncStore.delete(k)),
    };

    const item = await enqueue(asyncStorage, "p1", { mode: "catat", text: "async test", ts: NOW }, genId);
    expect(await readQueue(asyncStorage, "p1")).toEqual([item]);
    await remove(asyncStorage, "p1", item.id);
    expect(await readQueue(asyncStorage, "p1")).toEqual([]);
    expect(asyncStore.has("datum.chat.queue.p1")).toBe(false);
  });
});
