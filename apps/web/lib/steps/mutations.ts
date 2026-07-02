import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { backScheduleSteps } from "@/lib/steps/back-schedule";
import { projectStepStatus } from "@/lib/steps/status";
import type { TradeStepDep, TradeStepTemplate } from "@/lib/steps/types";
import type { SelectedMatch } from "@/lib/steps/infer";

/** Call the SQL instantiation function for an area (idempotent). */
export async function instantiateAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { error } = await supabase.rpc("seed_area_steps", { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Compute planned windows for an area's steps from each gate's target window
 * and persist them onto area_steps. Gates with no target window are skipped.
 */
export async function writePlannedDates(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { data: gates } = await supabase
    .from("area_gate_status")
    .select("gate_code, target_start_date, target_end_date")
    .eq("area_id", areaId);
  const { data: deps } = await supabase
    .from("trade_step_deps").select("step_code, predecessor_code");

  for (const g of gates ?? []) {
    if (!g.target_start_date || !g.target_end_date) continue;
    const { data: tmpl } = await supabase
      .from("trade_steps")
      .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability")
      .eq("gate_code", g.gate_code).eq("active", true).is("project_id", null);
    const plan = backScheduleSteps(
      (tmpl ?? []) as unknown as TradeStepTemplate[],
      (deps ?? []) as TradeStepDep[],
      { start: g.target_start_date, end: g.target_end_date },
    );
    for (const [code, win] of plan) {
      await supabase.from("area_steps")
        .update({ planned_start: win.planned_start, planned_end: win.planned_end })
        .eq("area_id", areaId).eq("step_code", code);
    }
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
  const [evRes, cpRes, punchRes] = await Promise.all([
    supabase.from("area_step_events").select("occurred_at, created_at, status, note, percent_complete, source").eq("area_step_id", areaStepId),
    supabase.from("area_step_checkpoints").select("required, result").eq("area_step_id", areaStepId),
    supabase.from("punch_items").select("severity, status").eq("area_step_id", areaStepId),
  ]);
  if (evRes.error || cpRes.error || punchRes.error) {
    throw evRes.error ?? cpRes.error ?? punchRes.error;
  }
  const events = evRes.data;
  const cps = cpRes.data;
  const punch = punchRes.data;

  const r = projectStepStatus({
    workEvents: (events ?? []).map((e) => ({
      occurred_at: e.occurred_at,
      created_at: e.created_at,
      source: (e.source ?? "human") as "human" | "ai",
      payload: {
        status: e.status,
        percent_complete: e.percent_complete ?? undefined,
        blocked_on: e.note ?? undefined,
      },
    })),
    checkpoints: (cps ?? []) as { required: boolean; result: "pending" | "pass" | "fail" }[],
    punchItems: (punch ?? []) as { severity: "kritis" | "mayor" | "minor"; status: "open" | "fixing" | "closed" }[],
  });

  const { error: upErr } = await supabase
    .from("area_steps")
    .update({
      status: r.status,
      actual_start: r.actualStart,
      actual_end: r.actualEnd,
      last_progress_at: r.lastProgressAt,
      blocking_reason: r.blockingReason,
    })
    .eq("id", areaStepId);
  if (upErr) throw upErr;
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

export type SetCheckpointArgs = {
  checkpointId: string;
  result: "pending" | "pass" | "fail";
  checkedByStaffId?: string;
};

export async function setCheckpointResult(
  supabase: SupabaseClient<Database>,
  args: SetCheckpointArgs,
): Promise<void> {
  const { data: cp, error } = await supabase
    .from("area_step_checkpoints")
    .select("area_step_id")
    .eq("id", args.checkpointId)
    .single();
  if (error || !cp) throw error ?? new Error("checkpoint not found");

  const { error: upErr } = await supabase
    .from("area_step_checkpoints")
    .update({
      result: args.result,
      checked_by: args.checkedByStaffId ?? null,
      checked_at: new Date().toISOString(),
    })
    .eq("id", args.checkpointId);
  if (upErr) throw upErr;

  await projectAreaStep(supabase, cp.area_step_id);
}

/** Reversibly soft-remove a step from its area. */
export async function removeAreaStep(
  supabase: SupabaseClient<Database>,
  args: { areaStepId: string },
): Promise<void> {
  const { error } = await supabase
    .from("area_steps")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", args.areaStepId);
  if (error) throw error;
}

/** Restore a soft-removed step. */
export async function restoreAreaStep(
  supabase: SupabaseClient<Database>,
  args: { areaStepId: string },
): Promise<void> {
  const { error } = await supabase
    .from("area_steps")
    .update({ removed_at: null })
    .eq("id", args.areaStepId);
  if (error) throw error;
}

/**
 * Write AI-inferred step events for one card event, then re-project each step.
 * Idempotent via the (card_event_id, area_step_id) unique index on source='ai'
 * — a duplicate insert errors with code 23505, which we swallow.
 */
export async function applyStepInference(
  supabase: SupabaseClient<Database>,
  args: { cardEventId: string; projectId: string; occurredAt: string; selected: SelectedMatch[] },
): Promise<void> {
  for (const m of args.selected) {
    const { error } = await supabase.from("area_step_events").insert({
      area_step_id: m.area_step_id,
      project_id: args.projectId,
      status: m.status,
      note: m.blocked_on,
      percent_complete: null,
      source: "ai",
      confidence: m.confidence,
      card_event_id: args.cardEventId,
      occurred_at: args.occurredAt,
    });
    // 23505 = unique_violation (already inferred for this card event) → skip re-project.
    if (error) {
      if ((error as { code?: string }).code === "23505") continue;
      throw error;
    }
    await projectAreaStep(supabase, m.area_step_id);
  }
}
