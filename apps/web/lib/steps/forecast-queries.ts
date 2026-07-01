import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import type { StepStatus, StepType, TradeStepDep } from "@/lib/steps/types";
import { forecastArea, type AreaForecast } from "@/lib/steps/forecast";

export type AreaForecastRow = AreaForecast & { areaId: string; areaName: string };
export type ProjectForecast = {
  projectId: string;
  targetHandover: string | null;
  projectedHandover: string | null;
  slipDays: number | null;
  worstArea: { areaName: string; slipDays: number | null; projectedFinish: string | null } | null;
  areas: AreaForecastRow[];
};

/** Forecast every area of a project and roll up to the worst (critical) area. */
export async function getProjectForecast(
  supabase: SupabaseClient<Database>,
  projectId: string,
  today: string,
): Promise<ProjectForecast> {
  const { data: rawSteps, error: stepsErr } = await supabase
    .from("area_steps")
    .select(`step_code, status, planned_start, actual_start, actual_end, area_id,
      trade_steps:step_code ( step_type, lead_time_days, typical_duration_days )`)
    .eq("project_id", projectId);
  if (stepsErr) throw stepsErr;

  const { data: depsRaw, error: depsErr } = await supabase
    .from("trade_step_deps").select("step_code, predecessor_code");
  if (depsErr) throw depsErr;
  const deps = (depsRaw ?? []) as TradeStepDep[];

  const { data: gates, error: gatesErr } = await supabase
    .from("area_gate_status").select("area_id, target_end_date").eq("project_id", projectId);
  if (gatesErr) throw gatesErr;
  const targetOf = new Map<string, string>();
  for (const g of gates ?? []) {
    if (!g.target_end_date) continue;
    const cur = targetOf.get(g.area_id);
    if (!cur || g.target_end_date > cur) targetOf.set(g.area_id, g.target_end_date);
  }

  const areaIds = [...new Set((rawSteps ?? []).map((r) => r.area_id))];
  const areaNameMap = new Map<string, string>();
  if (areaIds.length > 0) {
    const { data: areas, error: areasErr } = await supabase
      .from("areas").select("id, area_name").in("id", areaIds);
    if (areasErr) throw areasErr;
    for (const a of areas ?? []) areaNameMap.set(a.id, a.area_name);
  }

  const byArea = new Map<string, typeof rawSteps>();
  for (const r of rawSteps ?? []) {
    const b = byArea.get(r.area_id) ?? [];
    b.push(r); byArea.set(r.area_id, b);
  }

  const areaRows: AreaForecastRow[] = [];
  for (const [areaId, rows] of byArea) {
    const steps = (rows ?? []).map((r) => {
      const t = r.trade_steps as { step_type: string; lead_time_days: number; typical_duration_days: number } | null;
      return {
        step_code: r.step_code,
        step_type: (t?.step_type ?? "site_work") as StepType,
        status: r.status as StepStatus,
        typical_duration_days: t?.typical_duration_days ?? 1,
        lead_time_days: t?.lead_time_days ?? 0,
        planned_start: r.planned_start ?? null,
        actual_start: r.actual_start ?? null,
        actual_end: r.actual_end ?? null,
      };
    });
    const fc = forecastArea(steps, deps, today, targetOf.get(areaId) ?? null);
    areaRows.push({ ...fc, areaId, areaName: areaNameMap.get(areaId) ?? areaId });
  }

  let targetHandover: string | null = null;
  let projectedHandover: string | null = null;
  let worst: AreaForecastRow | null = null;
  for (const a of areaRows) {
    if (a.target && (!targetHandover || a.target > targetHandover)) targetHandover = a.target;
    if (a.target && a.projectedFinish && (!projectedHandover || a.projectedFinish > projectedHandover)) projectedHandover = a.projectedFinish;
    if (a.slipDays != null && (worst === null || (worst.slipDays ?? -Infinity) < a.slipDays)) worst = a;
  }

  return {
    projectId,
    targetHandover,
    projectedHandover,
    slipDays: worst?.slipDays ?? null,
    worstArea: worst ? { areaName: worst.areaName, slipDays: worst.slipDays, projectedFinish: worst.projectedFinish } : null,
    areas: areaRows,
  };
}
