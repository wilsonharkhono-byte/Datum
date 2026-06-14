"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type CardsChange = { kind: "card" | "event" | "comment" | "topic" };

/** Subscribe to changes on cards/card_events/card_comments/topics for one
    project. onChange fires after a brief debounce so we don't refresh on every
    keystroke of someone else's typing. Returns an unsubscribe function.
    (topics = board columns; requires topics in the supabase_realtime
    publication — see migration 20260615000001.) */
export function subscribeToProjectChanges(
  projectId: string,
  onChange: (c: CardsChange) => void,
): () => void {
  const supabase = createSupabaseBrowserClient();
  let pending: number | null = null;
  function emit(kind: CardsChange["kind"]) {
    if (pending) window.clearTimeout(pending);
    pending = window.setTimeout(() => onChange({ kind }), 250);
  }
  const channel = supabase
    .channel(`project:${projectId}`)
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "cards", filter: `project_id=eq.${projectId}` },
      () => emit("card"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "card_events", filter: `project_id=eq.${projectId}` },
      () => emit("event"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "card_comments", filter: `project_id=eq.${projectId}` },
      () => emit("comment"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "topics", filter: `project_id=eq.${projectId}` },
      () => emit("topic"),
    )
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
