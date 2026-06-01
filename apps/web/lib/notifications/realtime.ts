"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type UnreadDelta = { kind: "insert" } | { kind: "refresh" };

/**
 * Subscribe to notification inserts for the current authenticated user.
 * Returns an unsubscribe function.
 */
export function subscribeToOwnNotifications(
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void {
  const supabase = createSupabaseBrowserClient();
  const channel = supabase
    .channel(`notifications:${staffId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_staff_id=eq.${staffId}`,
      },
      () => onDelta({ kind: "insert" }),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `recipient_staff_id=eq.${staffId}`,
      },
      () => onDelta({ kind: "refresh" }),
    )
    .subscribe();

  return () => { void supabase.removeChannel(channel); };
}
