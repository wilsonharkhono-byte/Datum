import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { backScheduleSteps } from "@/lib/steps/back-schedule";
import { projectStepStatus } from "@/lib/steps/status";
import type { TradeStepDep, TradeStepTemplate } from "@/lib/steps/types";

/** Call the SQL instantiation function for an area (idempotent). */
export async function instantiateAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { error } = await supabase.rpc("seed_area_steps", { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Compute planned windows for an area's Gate B steps from the gate target
 * window and persist them onto area_steps. No-op if the gate window is unset.
 */
export async function writePlannedDates(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { data: gate } = await supabase
    .from("area_gate_status")
    .select("target_start_date, target_end_date")
    .eq("area_id", areaId)
    .eq("gate_code", "B")
    .maybeSingle();
  if (!gate?.target_start_date || !gate?.target_end_date) return;

  const { data: tmpl } = await supabase
    .from("trade_steps")
    .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability")
    .eq("gate_code", "B");
  const { data: deps } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");

  const plan = backScheduleSteps(
    (tmpl ?? []) as unknown as TradeStepTemplate[],
    (deps ?? []) as TradeStepDep[],
    { start: gate.target_start_date, end: gate.target_end_date },
  );

  for (const [code, win] of plan) {
    await supabase
      .from("area_steps")
      .update({ planned_start: win.planned_start, planned_end: win.planned_end })
      .eq("area_id", areaId)
      .eq("step_code", code);
  }
}

const EVENT_STATUS: Record<string, "not_started" | "in_progress" | "blocked" | "done"> = {
  not_started: "not_started",
  in_progress: "in_progress",
  blocked: "blocked",
  stalled: "blocked",
  done_with_defects: "done",
  accepted: "done",
};

/** Re-derive an area_step's status + actuals from its events, checkpoints, punch items. */
export async function projectAreaStep(
  supabase: SupabaseClient<Database>,
  areaStepId: string,
): Promise<void> {
  const [{ data: events }, { data: cps }, { data: punch }] = await Promise.all([
    supabase.from("area_step_events").select("occurred_at, created_at, status, note, percent_complete").eq("area_step_id", areaStepId),
    supabase.from("area_step_checkpoints").select("required, result").eq("area_step_id", areaStepId),
    supabase.from("punch_items").select("severity, status").eq("area_step_id", areaStepId),
  ]);

  const r = projectStepStatus({
    workEvents: (events ?? []).map((e) => ({
      occurred_at: e.occurred_at,
      created_at: e.created_at,
      payload: {
        status: e.status,
        percent_complete: e.percent_complete ?? undefined,
        blocked_on: e.note ?? undefined,
      },
    })),
    checkpoints: (cps ?? []) as { required: boolean; result: "pending" | "pass" | "fail" }[],
    punchItems: (punch ?? []) as { severity: "kritis" | "mayor" | "minor"; status: "open" | "fixing" | "closed" }[],
  });

  await supabase
    .from("area_steps")
    .update({
      status: r.status,
      actual_start: r.actualStart,
      actual_end: r.actualEnd,
      last_progress_at: r.lastProgressAt,
      blocking_reason: r.blockingReason,
    })
    .eq("id", areaStepId);
}

export type UpdateAreaStepArgs = {
  areaStepId: string;
  status?: "not_started" | "in_progress" | "blocked" | "done";
  note?: string;
  percentComplete?: number;
  loggedByStaffId?: string;
};

/** Log one step event (status change or progress note) then re-project. */
export async function updateAreaStep(
  supabase: SupabaseClient<Database>,
  args: UpdateAreaStepArgs,
): Promise<void> {
  const { data: step, error } = await supabase
    .from("area_steps")
    .select("project_id, status")
    .eq("id", args.areaStepId)
    .single();
  if (error || !step) throw error ?? new Error("area_step not found");

  const eventStatus = args.status ?? EVENT_STATUS[step.status] ?? "in_progress";

  const { error: insErr } = await supabase.from("area_step_events").insert({
    area_step_id: args.areaStepId,
    project_id: step.project_id,
    status: eventStatus,
    note: args.note ?? null,
    percent_complete: args.percentComplete ?? null,
    logged_by_staff_id: args.loggedByStaffId ?? null,
  });
  if (insErr) throw insErr;

  await projectAreaStep(supabase, args.areaStepId);
}
