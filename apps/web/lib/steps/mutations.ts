import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { backScheduleSteps } from "@/lib/steps/back-schedule";
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
