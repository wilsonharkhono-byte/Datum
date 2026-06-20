import type { DatumClient } from "../client";

export type UnreadDelta = { kind: "insert" } | { kind: "refresh" };

/** Subscribe to notification inserts/updates for one staff member. Returns an
    unsubscribe. The Supabase client is injected (web + React Native). */
export function subscribeToOwnNotifications(
  supabase: DatumClient,
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void {
  const channel = supabase
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
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
