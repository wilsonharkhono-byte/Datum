import type { DatumClient } from "../client";

/** Health transitions of a resilient realtime subscription:
    - "down": the channel errored/timed out/closed unexpectedly; a resubscribe
      is being retried with backoff. UI may show a stale-data hint.
    - "recovered": a resubscribe succeeded after a "down". Events that occurred
      during the gap were missed — callers should refetch/invalidate. */
export type ChannelHealth = "down" | "recovered";

type BuiltChannel = ReturnType<DatumClient["channel"]>;

const MAX_RETRY_DELAY_MS = 30_000;

/** Subscribe a channel with automatic resubscribe on failure.

    `build()` must return a fresh, not-yet-subscribed channel with all `.on()`
    handlers attached (a Supabase channel can't be re-subscribed after an
    error, so recovery needs a new instance). Returns an unsubscribe function.

    Without this, `.subscribe()` drops CHANNEL_ERROR/TIMED_OUT/CLOSED on the
    floor and the UI silently freezes on stale data until a full reload. */
export function subscribeResilient(
  supabase: DatumClient,
  build: () => BuiltChannel,
  onHealth?: (h: ChannelHealth) => void,
): () => void {
  let stopped = false;
  let wasDown = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let channel = build();

  function scheduleRetry() {
    if (stopped || retryTimer != null) return;
    if (!wasDown) {
      wasDown = true;
      onHealth?.("down");
    }
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (stopped) return;
      void supabase.removeChannel(channel);
      channel = build();
      subscribe();
    }, delay);
  }

  function subscribe() {
    channel.subscribe((status) => {
      if (stopped) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        if (wasDown) {
          wasDown = false;
          onHealth?.("recovered");
        }
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED. CLOSED only reaches here when the
      // socket died on its own — after stop() the `stopped` guard returns first.
      scheduleRetry();
    });
  }

  subscribe();
  return () => {
    stopped = true;
    if (retryTimer != null) clearTimeout(retryTimer);
    void supabase.removeChannel(channel);
  };
}
