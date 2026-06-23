"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { subscribeToProjectChanges as core, type CardsChange } from "@datum/core";

export type { CardsChange };

export function subscribeToProjectChanges(
  projectId: string,
  onChange: (c: CardsChange) => void,
): () => void {
  return core(createSupabaseBrowserClient(), projectId, onChange);
}
