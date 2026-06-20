import { describe, it, expect } from "vitest";
import { createKVPersister, type AsyncKV } from "./persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

function memoryKV(): AsyncKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

const sample = { clientState: { queries: [], mutations: [] }, timestamp: 1, buster: "v1" } as unknown as PersistedClient;

describe("createKVPersister", () => {
  it("round-trips a persisted client through the injected store", async () => {
    const kv = memoryKV();
    const p = createKVPersister(kv, "datum.rq.user1");
    await p.persistClient(sample);
    expect(kv.store.has("datum.rq.user1")).toBe(true);
    const restored = await p.restoreClient();
    expect(restored).toEqual(sample);
    await p.removeClient();
    expect(await p.restoreClient()).toBeUndefined();
  });
});
