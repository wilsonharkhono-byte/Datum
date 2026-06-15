import { QueryClient } from "@tanstack/react-query";

/** Bump when the persisted cache shape changes so old IndexedDB data is dropped. */
export const CACHE_BUSTER = "v1";
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: CACHE_MAX_AGE,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false, // Trello-style: don't poll a board nobody is viewing
        retry: 1,
      },
    },
  });
}
