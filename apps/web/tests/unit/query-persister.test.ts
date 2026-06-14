import { describe, expect, it } from "vitest";
import { createKVPersister, type AsyncKV } from "@/lib/query/persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

function memoryKV(): AsyncKV & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: async (k) => dump.get(k) ?? null,
    setItem: async (k, v) => void dump.set(k, v),
    removeItem: async (k) => void dump.delete(k),
  };
}

const sample = { clientState: { queries: [], mutations: [] }, timestamp: 1, buster: "v1" } as unknown as PersistedClient;

describe("createKVPersister", () => {
  it("round-trips a persisted client", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.u1");
    await p.persistClient(sample);
    expect(kv.dump.has("datum.rq.u1")).toBe(true);
    const restored = await p.restoreClient();
    expect(restored).toEqual(sample);
  });

  it("returns undefined when nothing is stored", async () => {
    const p = createKVPersister(memoryKV(), "datum.rq.u1");
    expect(await p.restoreClient()).toBeUndefined();
  });

  it("removes the client", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.u1");
    await p.persistClient(sample);
    await p.removeClient();
    expect(kv.dump.has("datum.rq.u1")).toBe(false);
  });
});
