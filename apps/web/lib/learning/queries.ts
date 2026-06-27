import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { gateShortName } from "@datum/core";
import { learnedDurationRows, type DurationInstance, type LearnedRow, type StandardStepRow } from "@/lib/learning/durations";

export async function getDurationLearning(
  supabase: SupabaseClient<Database>,
): Promise<{ gate: string; gateName: string; rows: LearnedRow[] }[]> {
  const [{ data: steps, error: e1 }, { data: inst, error: e2 }] = await Promise.all([
    supabase
      .from("trade_steps")
      .select("code, gate_code, name, typical_duration_days")
      .is("project_id", null).eq("source", "standard").eq("active", true)
      .order("gate_code").order("sort_order"),
    supabase
      .from("area_steps")
      .select("step_code, actual_start, actual_end")
      .in("status", ["accepted", "done_with_defects"])
      .not("actual_start", "is", null).not("actual_end", "is", null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const rows = learnedDurationRows(
    (inst ?? []) as DurationInstance[],
    (steps ?? []) as unknown as StandardStepRow[],
    gateShortName,
  );

  const order: string[] = [];
  const byGate = new Map<string, LearnedRow[]>();
  for (const r of rows) {
    if (!byGate.has(r.gate_code)) { byGate.set(r.gate_code, []); order.push(r.gate_code); }
    byGate.get(r.gate_code)!.push(r);
  }
  return order.map((g) => ({ gate: g, gateName: gateShortName(g), rows: byGate.get(g)! }));
}
