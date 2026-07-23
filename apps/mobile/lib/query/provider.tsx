import { useEffect, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { onlineManager, focusManager, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { makeQueryClient, createKVPersister, CACHE_BUSTER, CACHE_MAX_AGE, PERSISTED_KEY_ROOTS } from "@datum/core";
import { asyncStorageKV } from "@/lib/query/async-kv";

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
);

/**
 * Always provides a QueryClient. With a userId the cache persists to
 * AsyncStorage under that user's key; without one (pre-login frames, the
 * login screen) it is a plain in-memory client — screens can safely call
 * useQuery in any auth state. Callers key this component by user so each
 * identity gets a fresh client (no cross-user cache bleed).
 */
export function QueryProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  const [persister] = useState(() =>
    userId ? createKVPersister(asyncStorageKV, `datum.rq.${userId}`) : null,
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) =>
      focusManager.setFocused(s === "active"),
    );
    return () => sub.remove();
  }, []);

  if (!persister) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

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
