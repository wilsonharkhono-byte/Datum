import type { DatumClient } from "../client";
import { subscribeResilient, type ChannelHealth } from "./resilient";

export type UnreadDelta = { kind: "insert" } | { kind: "refresh" };

/** Subscribe to notification inserts/updates for one staff member. Returns an
    unsubscribe. The Supabase client is injected (web + React Native).
    onHealth (optional) reports channel drops/recovery — on "recovered" the
    caller should refetch the canonical count (inserts during the gap were
    missed). */
export function subscribeToOwnNotifications(
  supabase: DatumClient,
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
  onHealth?: (h: ChannelHealth) => void,
): () => void {
  return subscribeResilient(
    supabase,
    () =>
      supabase
        .channel(`notifications:${staffId}`)
        .on(
          "postgres_changes" as never,
          { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_staff_id=eq.${staffId}` },
          () => onDelta({ kind: "insert" }),
        )
        .on(
          "postgres_changes" as never,
          { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_staff_id=eq.${staffId}` },
          () => onDelta({ kind: "refresh" }),
        ),
    onHealth,
  );
}
