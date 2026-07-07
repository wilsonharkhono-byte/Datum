import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import type { TradeStepDep } from "@/lib/steps/types";

/**
 * Shared reference-data fetches for the steps slice. These two shapes were
 * copy-pasted across queries/mutations/forecast and had started to drift —
 * single source here (AUDIT_CODE #6).
 */

/** The full step dependency graph. Unscoped by design: trade_step_deps has no
    gate column (PK is step_code+predecessor_code); consumers intersect against
    their own step codes. */
export async function getTradeStepDeps(
  supabase: SupabaseClient<Database>,
): Promise<TradeStepDep[]> {
  const { data, error } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  if (error) throw error;
  return (data ?? []) as TradeStepDep[];
}

export type CatalogStepRow = {
  code: string;
  name: string;
  applies_to_area_types: string[] | null;
};

/** Active firm-standard step catalog (template rows, project_id null),
    gate-then-sort ordered — the "addable steps" list. */
export async function getStandardCatalogSteps(
  supabase: SupabaseClient<Database>,
): Promise<CatalogStepRow[]> {
  const { data, error } = await supabase
    .from("trade_steps")
    .select("code, name, applies_to_area_types")
    .eq("active", true)
    .is("project_id", null)
    .order("gate_code")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as CatalogStepRow[];
}
