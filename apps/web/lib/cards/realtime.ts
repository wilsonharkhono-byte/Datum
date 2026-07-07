"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  subscribeToProjectChanges as core,
  type CardsChange,
  type ChannelHealth,
} from "@datum/core";

export type { CardsChange, ChannelHealth };

export function subscribeToProjectChanges(
  projectId: string,
  onChange: (c: CardsChange) => void,
  onHealth?: (h: ChannelHealth) => void,
): () => void {
  return core(createSupabaseBrowserClient(), projectId, onChange, onHealth);
}
