import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";

export type AreaStepEventRow = {
  id: string;
  area_step_id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string;
  author_name: string | null;
};

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

/** All trade steps instantiated for one area, ordered by template sort_order, with checkpoints. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at,
      trade_steps:step_code (sort_order, step_type, name),
      area_step_checkpoints (id, item_text, severity, required, result, sort_order)
    `)
    .eq("area_id", areaId);
  if (error) throw error;

  return (data ?? [])
    .map((r) => {
      const tmpl = r.trade_steps as { sort_order: number; step_type: string; name: string } | null;
      const cps = (r.area_step_checkpoints as Array<AreaStepCheckpoint & { sort_order: number }> | null) ?? [];
      return {
        _sort: tmpl?.sort_order ?? 0,
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
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort, ...rest }) => rest as AreaStepRow);
}

/**
 * Fetch all events for an area's steps in one query (one round-trip), joined to staff.full_name.
 * Returns a map keyed by area_step_id for O(1) lookup in the render path.
 * Ordered newest-first within each step.
 */
export async function getAreaStepEvents(
  supabase: SupabaseClient<Database>,
  stepIds: string[],
): Promise<Map<string, AreaStepEventRow[]>> {
  if (stepIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("area_step_events")
    .select("id, area_step_id, status, note, percent_complete, occurred_at, created_at, staff:logged_by_staff_id (full_name)")
    .in("area_step_id", stepIds)
    .order("occurred_at", { ascending: false });
  if (error) throw error;

  const map = new Map<string, AreaStepEventRow[]>();
  for (const r of data ?? []) {
    const staffRow = r.staff as { full_name: string } | null;
    const row: AreaStepEventRow = {
      id: r.id,
      area_step_id: r.area_step_id,
      status: r.status,
      note: r.note,
      percent_complete: r.percent_complete !== null ? Number(r.percent_complete) : null,
      occurred_at: r.occurred_at ?? r.created_at,
      author_name: staffRow?.full_name ?? null,
    };
    const bucket = map.get(r.area_step_id) ?? [];
    bucket.push(row);
    map.set(r.area_step_id, bucket);
  }
  return map;
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
