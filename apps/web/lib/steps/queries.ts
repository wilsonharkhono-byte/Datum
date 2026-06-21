import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type AreaStepRow = {
  id: string;
  step_code: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
};

/** All trade steps instantiated for one area, ordered by the template sort_order. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at,
      trade_steps:step_code (sort_order)
    `)
    .eq("area_id", areaId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ ...r, _sort: (r.trade_steps as { sort_order: number } | null)?.sort_order ?? 0 }))
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort, trade_steps, ...rest }) => rest as AreaStepRow);
}
