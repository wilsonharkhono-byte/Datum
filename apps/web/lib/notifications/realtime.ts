"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { subscribeToOwnNotifications as core, type UnreadDelta } from "@datum/core";

export type { UnreadDelta };

export function subscribeToOwnNotifications(
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
): () => void {
  return core(createSupabaseBrowserClient(), staffId, onDelta);
}
