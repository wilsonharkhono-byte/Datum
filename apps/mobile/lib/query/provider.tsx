import { useEffect, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { makeQueryClient, createKVPersister, CACHE_BUSTER, CACHE_MAX_AGE, PERSISTED_KEY_ROOTS } from "@datum/core";
import { asyncStorageKV } from "@/lib/query/async-kv";

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
);

export function QueryProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [persister] = useState(() => createKVPersister(asyncStorageKV, `datum.rq.${userId}`));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) =>
      focusManager.setFocused(s === "active"),
    );
    return () => sub.remove();
  }, []);

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
