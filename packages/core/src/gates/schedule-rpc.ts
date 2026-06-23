import type { DatumClient } from "../client";

export type ScheduleRecomputeResult =
  | { ok: true; cellsUpdated: number }
  | { ok: false; error: string };

/**
 * Triggers the SQL RPC `compute_project_schedule` which writes
 * target_start_date / target_end_date from gates.active_weeks +
 * projects.kickoff_date. This is an anon-callable RPC under RLS — not a
 * "use server"-only action with web side effects.
 *
 * Web triggers this on kickoff-date change (apps/web/lib/gates/schedule.ts).
 * Mobile likely won't expose it in the schedule-gates slice v1 (see spec §11
 * out of scope) but it's extracted here for module coherence.
 *
 * NOTE: recomputeProjectGates (gates/recompute.ts) runs the JS rule engine and
 * writes status/readiness_score. This RPC writes schedule windows only — they
 * are two separate recomputes (spec §2 key invariants).
 */
export async function recomputeProjectSchedule(
  sb: DatumClient,
  projectId: string,
): Promise<ScheduleRecomputeResult> {
  const { error } = await sb.rpc("compute_project_schedule", { p_project_id: projectId });
  if (error) return { ok: false, error: error.message };

  const { count } = await sb
    .from("area_gate_status")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .not("target_start_date", "is", null);

  return { ok: true, cellsUpdated: count ?? 0 };
}
