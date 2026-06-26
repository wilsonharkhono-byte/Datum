import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { gateShortName } from "@datum/core";

export type StandardStep = {
  code: string;
  gate_code: string;
  name: string;
  step_type: string;
  trade_role: string | null;
  typical_duration_days: number;
  lead_time_days: number;
  sort_order: number;
  applies_to_area_types: string[] | null;
  applicability: Record<string, unknown>;
  active: boolean;
};

export type StandardLibraryGate = {
  gate: string;
  gateName: string;
  active: StandardStep[];
  inactive: StandardStep[];
};

/** Group firm-standard steps by gate (A→H), split active/inactive, each sorted by sort_order. */
export function groupStandardLibrary(steps: StandardStep[]): StandardLibraryGate[] {
  const order: string[] = [];
  const byGate = new Map<string, StandardStep[]>();
  for (const s of steps) {
    if (!byGate.has(s.gate_code)) { byGate.set(s.gate_code, []); order.push(s.gate_code); }
    byGate.get(s.gate_code)!.push(s);
  }
  order.sort((a, b) => a.localeCompare(b));
  return order.map((gate) => {
    const all = byGate.get(gate)!.slice().sort((a, b) => a.sort_order - b.sort_order);
    return {
      gate,
      gateName: gateShortName(gate),
      active: all.filter((s) => s.active),
      inactive: all.filter((s) => !s.active),
    };
  });
}

/** Fetch the whole firm-standard library (active + inactive), grouped by gate. */
export async function getStandardLibrary(
  supabase: SupabaseClient<Database>,
): Promise<StandardLibraryGate[]> {
  const { data, error } = await supabase
    .from("trade_steps")
    .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applies_to_area_types, applicability, active")
    .is("project_id", null)
    .eq("source", "standard")
    .order("gate_code")
    .order("sort_order");
  if (error) throw error;
  return groupStandardLibrary((data ?? []) as unknown as StandardStep[]);
}
