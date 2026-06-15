import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

export type AsyncKV = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** A react-query persister backed by any async key-value store. The store is
    injected so the production IndexedDB store and tests share one code path. */
export function createKVPersister(kv: AsyncKV, key: string): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await kv.setItem(key, JSON.stringify(client));
    },
    restoreClient: async () => {
      const raw = await kv.getItem(key);
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
    },
    removeClient: async () => {
      await kv.removeItem(key);
    },
  };
}
