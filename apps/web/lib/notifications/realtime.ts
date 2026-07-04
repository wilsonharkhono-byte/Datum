"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  subscribeToOwnNotifications as core,
  type UnreadDelta,
  type ChannelHealth,
} from "@datum/core";

export type { UnreadDelta, ChannelHealth };

export function subscribeToOwnNotifications(
  staffId: string,
  onDelta: (d: UnreadDelta) => void,
  onHealth?: (h: ChannelHealth) => void,
): () => void {
  return core(createSupabaseBrowserClient(), staffId, onDelta, onHealth);
}
