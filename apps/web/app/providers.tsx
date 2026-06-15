"use client";
import { useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { makeQueryClient, CACHE_BUSTER, CACHE_MAX_AGE } from "@/lib/query/client";
import { createKVPersister } from "@/lib/query/persister";
import { idbKV } from "@/lib/query/idb-kv";
import { PERSISTED_KEY_ROOTS } from "@/lib/query/keys";

export function Providers({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  // Namespace the persisted cache by user so a shared device never shows one
  // user's data to the next.
  const [persister] = useState(() => createKVPersister(idbKV, `datum.rq.${userId}`));

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            (PERSISTED_KEY_ROOTS as readonly string[]).includes(q.queryKey[0] as string),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
