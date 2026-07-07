"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  subscribeToAreaGateChanges as core,
  type AreaGatesChange,
  type ChannelHealth,
} from "@datum/core";

export type { AreaGatesChange, ChannelHealth };

export function subscribeToAreaGateChanges(
  projectId: string,
  onChange: (c: AreaGatesChange) => void,
  onHealth?: (h: ChannelHealth) => void,
): () => void {
  return core(createSupabaseBrowserClient(), projectId, onChange, onHealth);
}
