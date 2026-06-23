import type { DatumClient } from "../client";

export type AreaGatesChange = { kind: "area_gate_status" | "area" | "card_area" };

/**
 * Subscribe to changes on area_gate_status / areas / card_areas for one project.
 *
 * Column coverage:
 *   - area_gate_status: has project_id → filtered with `project_id=eq.${projectId}`
 *   - areas:            has project_id → filtered with `project_id=eq.${projectId}`
 *   - card_areas:       composite PK (card_id, area_id), no project_id column
 *                       → subscribed unfiltered (v1 simplest correct option; RLS
 *                         on the table still scopes data the user can read)
 *
 * onChange fires after a 250ms debounce. Returns an unsubscribe function.
 * The Supabase client is injected so this is usable from web and React Native.
 */
export function subscribeToAreaGateChanges(
  supabase: DatumClient,
  projectId: string,
  onChange: (c: AreaGatesChange) => void,
): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  function emit(kind: AreaGatesChange["kind"]) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => onChange({ kind }), 250);
  }
  const channel = supabase
    .channel(`area-gates:${projectId}`)
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "area_gate_status", filter: `project_id=eq.${projectId}` },
      () => emit("area_gate_status"),
    )
    .on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "areas", filter: `project_id=eq.${projectId}` },
      () => emit("area"),
    )
    .on(
      "postgres_changes" as never,
      // card_areas has no project_id — subscribed unfiltered; RLS scopes data
      { event: "*", schema: "public", table: "card_areas" },
      () => emit("card_area"),
    )
    .subscribe();
  return () => {
    if (pending) clearTimeout(pending);
    void supabase.removeChannel(channel);
  };
}
