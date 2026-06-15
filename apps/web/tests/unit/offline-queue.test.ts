import { beforeEach, describe, expect, it } from "vitest";
import {
  drain,
  enqueue,
  peek,
  readQueue,
  remove,
  QUEUE_CAP,
  TANYA_MAX_AGE_MS,
} from "@/lib/assistant/offline-queue";

/** Simple object shim standing in for window.localStorage. */
function storageShim() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

let shim: ReturnType<typeof storageShim>;

beforeEach(() => {
  shim = storageShim();
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
});

const NOW = 1_750_000_000_000;

describe("offline-queue enqueue/read", () => {
  it("round-trips an item with a generated id under the per-project key", () => {
    const item = enqueue("p1", { mode: "catat", text: "Cek besi kolom lantai 2", ts: NOW });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(shim.store.has("datum.chat.queue.p1")).toBe(true);
    expect(readQueue("p1")).toEqual([item]);
  });

  it("keeps items oldest first and isolates projects", () => {
    const a = enqueue("p1", { mode: "catat", text: "satu", ts: NOW });
    const b = enqueue("p1", { mode: "tanya", text: "dua", ts: NOW + 1 });
    enqueue("p2", { mode: "catat", text: "lain proyek", ts: NOW });
    expect(readQueue("p1").map((i) => i.id)).toEqual([a.id, b.id]);
    expect(readQueue("p2")).toHaveLength(1);
  });

  it("reads corrupt or non-array storage as empty", () => {
    shim.setItem("datum.chat.queue.p1", "{not json");
    expect(readQueue("p1")).toEqual([]);
    shim.setItem("datum.chat.queue.p1", JSON.stringify({ nope: true }));
    expect(readQueue("p1")).toEqual([]);
  });

  it("filters malformed entries but keeps valid ones", () => {
    const good = { id: "x", mode: "catat", text: "valid", ts: NOW };
    shim.setItem("datum.chat.queue.p1", JSON.stringify([good, { mode: "catat" }, 42]));
    expect(readQueue("p1")).toEqual([good]);
  });

  it("caps the queue at QUEUE_CAP, dropping the oldest items", () => {
    const ids: string[] = [];
    for (let i = 0; i < QUEUE_CAP + 5; i++) {
      ids.push(enqueue("p1", { mode: "catat", text: `note ${i}`, ts: NOW + i }).id);
    }
    const queued = readQueue("p1");
    expect(queued).toHaveLength(QUEUE_CAP);
    expect(queued.map((i) => i.id)).toEqual(ids.slice(5));
  });
});

describe("offline-queue peek/remove", () => {
  it("peek returns the oldest item without removing it", () => {
    const a = enqueue("p1", { mode: "catat", text: "pertama", ts: NOW });
    enqueue("p1", { mode: "catat", text: "kedua", ts: NOW + 1 });
    expect(peek("p1")).toEqual(a);
    expect(readQueue("p1")).toHaveLength(2);
    expect(peek("kosong")).toBeUndefined();
  });

  it("remove deletes exactly one item by id and is a no-op for unknown ids", () => {
    const a = enqueue("p1", { mode: "catat", text: "satu", ts: NOW });
    const b = enqueue("p1", { mode: "catat", text: "dua", ts: NOW + 1 });
    remove("p1", a.id);
    expect(readQueue("p1")).toEqual([b]);
    remove("p1", "bukan-id");
    expect(readQueue("p1")).toEqual([b]);
  });

  it("removing the last item clears the storage key", () => {
    const a = enqueue("p1", { mode: "catat", text: "satu", ts: NOW });
    remove("p1", a.id);
    expect(shim.store.has("datum.chat.queue.p1")).toBe(false);
  });
});

describe("offline-queue drain", () => {
  it("returns items oldest first WITHOUT removing them (remove-on-success is the caller's job)", () => {
    const a = enqueue("p1", { mode: "catat", text: "satu", ts: NOW - 1000 });
    const b = enqueue("p1", { mode: "tanya", text: "dua", ts: NOW });
    expect(drain("p1", NOW).map((i) => i.id)).toEqual([a.id, b.id]);
    expect(readQueue("p1")).toHaveLength(2);
  });

  it("silently drops Tanya items older than 30 minutes and persists the prune", () => {
    const stale = enqueue("p1", { mode: "tanya", text: "basi", ts: NOW - TANYA_MAX_AGE_MS - 1 });
    const fresh = enqueue("p1", { mode: "tanya", text: "segar", ts: NOW - TANYA_MAX_AGE_MS });
    const drained = drain("p1", NOW);
    expect(drained.map((i) => i.id)).toEqual([fresh.id]);
    expect(readQueue("p1").map((i) => i.id)).toEqual([fresh.id]);
    expect(readQueue("p1").some((i) => i.id === stale.id)).toBe(false);
  });

  it("never drops Catat notes regardless of age", () => {
    const old = enqueue("p1", { mode: "catat", text: "catatan lama", ts: NOW - 7 * 24 * 60 * 60 * 1000 });
    expect(drain("p1", NOW).map((i) => i.id)).toEqual([old.id]);
    expect(readQueue("p1")).toHaveLength(1);
  });

  it("returns empty for an empty queue", () => {
    expect(drain("p1", NOW)).toEqual([]);
  });
});
