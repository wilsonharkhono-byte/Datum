import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";
import { computeStepSignals } from "@/lib/steps/signals";
import type { StepSignal } from "@/lib/steps/signals";

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

// ─── Project-wide signal query ────────────────────────────────────────────────

/**
 * One entry in the flat, sorted list returned by `getProjectStepSignals`.
 */
export type ProjectStepSignalRow = {
  areaId: string;
  areaName: string;
  stepCode: string;
  stepName: string;
  /** Matches trade_steps.trade_role — used by the reminder cron for recipient resolution. */
  tradeRole: string | null;
  signal: StepSignal;
};

/**
 * Fetch ALL area_steps for a project (joined to trade_steps template fields +
 * area name), pull the shared dep graph once, run `computeStepSignals` per
 * area in memory, and return a flat severity-sorted list of signals.
 *
 * - One round-trip for the steps+template join.
 * - One round-trip for trade_step_deps.
 * - One round-trip for area names (via matrix_areas).
 * - Grouping + comparator runs entirely in memory.
 *
 * `today` and `now` are supplied by the caller (the server page computes WIB
 * today so this stays pure and testable).
 */
export async function getProjectStepSignals(
  supabase: SupabaseClient<Database>,
  projectId: string,
  today: string,
  now?: string,
): Promise<ProjectStepSignalRow[]> {
  // 1. Fetch all area_steps for the project, joined to trade_steps template.
  const { data: rawSteps, error: stepsErr } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      actual_start, actual_end, blocking_reason, last_progress_at,
      area_id,
      trade_steps:step_code (
        name, step_type, trade_role, lead_time_days, typical_duration_days
      )
    `)
    .eq("project_id", projectId);
  if (stepsErr) throw stepsErr;

  // 2. Fetch dep edges once (shared across all areas).
  const { data: depsRaw, error: depsErr } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  if (depsErr) throw depsErr;
  const deps = (depsRaw ?? []) as TradeStepDep[];

  // 3. Fetch area names for all areas that appear in the step list.
  const areaIds = [...new Set((rawSteps ?? []).map((r) => r.area_id))];
  const areaNameMap = new Map<string, string>();
  if (areaIds.length > 0) {
    const { data: areas, error: areasErr } = await supabase
      .from("areas")
      .select("id, area_name")
      .in("id", areaIds);
    if (areasErr) throw areasErr;
    for (const a of areas ?? []) {
      areaNameMap.set(a.id, a.area_name);
    }
  }

  // 4. Group steps by area_id and assemble SignalStep[] per area.
  const byArea = new Map<string, typeof rawSteps>();
  for (const row of rawSteps ?? []) {
    const bucket = byArea.get(row.area_id) ?? [];
    bucket.push(row);
    byArea.set(row.area_id, bucket);
  }

  // 5. Run comparator per area, collect + flatten results.
  const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    warning: 2,
    info: 3,
  };

  const allSignalRows: ProjectStepSignalRow[] = [];

  for (const [areaId, areaSteps] of byArea) {
    const areaName = areaNameMap.get(areaId) ?? areaId;

    const signalSteps = (areaSteps ?? []).map((r) => {
      const tmpl = r.trade_steps as {
        name: string;
        step_type: string;
        trade_role: string | null;
        lead_time_days: number;
        typical_duration_days: number;
      } | null;

      return {
        step_code: r.step_code,
        name: tmpl?.name ?? r.step_code,
        step_type: (tmpl?.step_type ?? "site_work") as import("@/lib/steps/types").StepType,
        trade_role: tmpl?.trade_role ?? null,
        lead_time_days: tmpl?.lead_time_days ?? 0,
        typical_duration_days: tmpl?.typical_duration_days ?? 1,
        status: r.status as import("@/lib/steps/types").StepStatus,
        planned_start: r.planned_start ?? null,
        planned_end: r.planned_end ?? null,
        actual_start: r.actual_start ?? null,
        actual_end: r.actual_end ?? null,
        last_progress_at: r.last_progress_at ?? null,
        blocking_reason: r.blocking_reason ?? null,
      };
    });

    const signals = computeStepSignals({ steps: signalSteps, deps, today, now });

    // Build name + trade_role lookups keyed by step_code for the signal rows.
    const stepNameMap = new Map(signalSteps.map((s) => [s.step_code, s.name]));
    const stepTradeRoleMap = new Map(signalSteps.map((s) => [s.step_code, s.trade_role]));

    for (const sig of signals) {
      allSignalRows.push({
        areaId,
        areaName,
        stepCode: sig.stepCode,
        stepName: stepNameMap.get(sig.stepCode) ?? sig.stepCode,
        tradeRole: stepTradeRoleMap.get(sig.stepCode) ?? null,
        signal: sig,
      });
    }
  }

  // 6. Sort overall: critical → high → warning → info, then areaName, stepCode.
  allSignalRows.sort((a, b) => {
    const sev =
      (SEVERITY_ORDER[a.signal.severity] ?? 3) -
      (SEVERITY_ORDER[b.signal.severity] ?? 3);
    if (sev !== 0) return sev;
    const area = a.areaName.localeCompare(b.areaName);
    if (area !== 0) return area;
    return a.stepCode.localeCompare(b.stepCode);
  });

  return allSignalRows;
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

/** Firm-standard steps not yet instantiated on this area, filtered to those applicable to the area's type. */
export async function getAddableCatalogSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<CatalogStep[]> {
  const { data: area } = await supabase.from("areas").select("area_type").eq("id", areaId).single();
  const areaType = area?.area_type ?? null;
  const [{ data: existing, error: e1 }, { data: catalog, error: e2 }] = await Promise.all([
    supabase.from("area_steps").select("step_code").eq("area_id", areaId),
    supabase.from("trade_steps").select("code, name, applies_to_area_types")
      .eq("active", true).is("project_id", null).order("gate_code").order("sort_order"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const applicable = (catalog ?? []).filter((c) => {
    const types = (c.applies_to_area_types as string[] | null) ?? null;
    return types === null || (areaType !== null && types.includes(areaType));
  });
  return addableCatalog(
    applicable.map((c) => ({ code: c.code, name: c.name })),
    (existing ?? []).map((r) => r.step_code),
  );
}
