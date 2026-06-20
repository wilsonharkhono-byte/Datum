import type { DatumClient } from "../client";

export type CardsChange = { kind: "card" | "event" | "comment" | "topic" };

/** Subscribe to changes on cards/card_events/card_comments/topics for one
    project. onChange fires after a 250ms debounce. Returns an unsubscribe.
    The Supabase client is injected so this is usable from web and React Native. */
export function subscribeToProjectChanges(
  supabase: DatumClient,
  projectId: string,
  onChange: (c: CardsChange) => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  function emit(kind: CardsChange["kind"]) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => onChange({ kind }), 250);
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
  return () => {
    if (pending) clearTimeout(pending);
    void supabase.removeChannel(channel);
  };
}
