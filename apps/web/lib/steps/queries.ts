import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";

export type AreaStepCheckpoint = {
  id: string;
  item_text: string;
  severity: string;
  required: boolean;
  result: string;
};

export type AreaStepRow = {
  id: string;
  step_code: string;
  name: string;
  step_type: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
  checkpoints: AreaStepCheckpoint[];
};

export type CatalogStep = { code: string; name: string };
export type RemovedStep = { id: string; step_code: string; name: string };

/** Pure: standard catalog steps whose code is not already instantiated on the area. */
export function addableCatalog(catalog: CatalogStep[], existingCodes: string[]): CatalogStep[] {
  const have = new Set(existingCodes);
  return catalog.filter((c) => !have.has(c.code));
}

/** Active trade steps instantiated for one area, ordered by template sort_order then created_at, with checkpoints. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at, created_at,
      trade_steps:step_code (sort_order, step_type, name),
      area_step_checkpoints (id, item_text, severity, required, result, sort_order)
    `)
    .eq("area_id", areaId)
    .is("removed_at", null);
  if (error) throw error;

  return (data ?? [])
    .map((r) => {
      const tmpl = r.trade_steps as { sort_order: number; step_type: string; name: string } | null;
      const cps = (r.area_step_checkpoints as Array<AreaStepCheckpoint & { sort_order: number }> | null) ?? [];
      return {
        _sort: tmpl?.sort_order ?? 0,
        _created: r.created_at as string,
        id: r.id,
        step_code: r.step_code,
        name: tmpl?.name ?? r.step_code,
        step_type: tmpl?.step_type ?? "site_work",
        status: r.status,
        planned_start: r.planned_start,
        planned_end: r.planned_end,
        assigned_trade: r.assigned_trade,
        blocking_reason: r.blocking_reason,
        last_progress_at: r.last_progress_at,
        checkpoints: [...cps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((c) => ({ id: c.id, item_text: c.item_text, severity: c.severity, required: c.required, result: c.result })),
      };
    })
    .sort((a, b) => a._sort - b._sort || a._created.localeCompare(b._created))
    .map(({ _sort, _created, ...rest }) => rest as AreaStepRow);
}

/** Steps for an area plus the per-area flags (siap dimulai / perlu keputusan / blocked). */
export async function getAreaStepView(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<{ steps: AreaStepRow[]; flags: AreaFlags }> {
  const steps = await getAreaSteps(supabase, areaId);
  // Deps are fetched unscoped: trade_step_deps has no gate column (PK is
  // (step_code, predecessor_code)), so there is nothing to filter on here.
  // computeAreaFlags intersects deps against this area's own step_codes, so
  // foreign deps are harmlessly ignored.
  const { data: deps, error } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  if (error) throw error;
  const flags = computeAreaFlags(
    steps.map((s) => ({ step_code: s.step_code, step_type: s.step_type, status: s.status })),
    (deps ?? []) as TradeStepDep[],
  );
  return { steps, flags };
}

/** Steps the user soft-removed from this area (for the restore list). */
export async function getRemovedAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<RemovedStep[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select("id, step_code, trade_steps:step_code (name)")
    .eq("area_id", areaId)
    .not("removed_at", "is", null);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const tmpl = r.trade_steps as { name: string } | null;
    return { id: r.id, step_code: r.step_code, name: tmpl?.name ?? r.step_code };
  });
}

/** Firm-standard Gate B steps not yet instantiated on this area (the catalog picker). */
export async function getAddableCatalogSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<CatalogStep[]> {
  const [{ data: existing, error: e1 }, { data: catalog, error: e2 }] = await Promise.all([
    supabase.from("area_steps").select("step_code").eq("area_id", areaId),
    supabase.from("trade_steps").select("code, name")
      .eq("gate_code", "B").eq("active", true).is("project_id", null).order("sort_order"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return addableCatalog(
    (catalog ?? []) as CatalogStep[],
    (existing ?? []).map((r) => r.step_code),
  );
}
