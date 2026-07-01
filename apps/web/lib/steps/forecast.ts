import type { StepStatus, StepType, TradeStepDep } from "@/lib/steps/types";
import { addDays } from "@/lib/steps/back-schedule";

const DAY_MS = 86_400_000;

export type ForecastStep = {
  step_code: string;
  step_type: StepType;
  status: StepStatus;
  typical_duration_days: number;
  lead_time_days: number;
  planned_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
};

export type AreaForecast = {
  target: string | null;
  projectedFinish: string | null;
  slipDays: number | null;
  complete: boolean;
  hasPlan: boolean;
};

/** Whole calendar days a→b (b later ⇒ positive), on the YYYY-MM-DD date slices. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const db = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.round((db - da) / DAY_MS);
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

const DONE = new Set<StepStatus>(["accepted", "done_with_defects"]);

/** Project an area's finish forward from today + actuals; compare to its handover target. */
export function forecastArea(
  steps: ForecastStep[],
  deps: TradeStepDep[],
  today: string,
  target: string | null,
): AreaForecast {
  const applicable = steps.filter((s) => s.status !== "not_applicable");
  if (applicable.length === 0) {
    return { target, projectedFinish: null, slipDays: null, complete: false, hasPlan: false };
  }
  const hasPlan = applicable.some((s) => s.planned_start != null);

  const byCode = new Map(applicable.map((s) => [s.step_code, s]));
  const predsOf = new Map<string, string[]>();
  for (const s of applicable) predsOf.set(s.step_code, []);
  for (const d of deps) {
    if (byCode.has(d.step_code) && byCode.has(d.predecessor_code)) {
      predsOf.get(d.step_code)!.push(d.predecessor_code);
    }
  }

  const span = (s: ForecastStep): number => {
    const dur = Number.isFinite(s.typical_duration_days) ? Math.max(0, s.typical_duration_days) : 0;
    // Lead time is reserved for every NON-physical step (decision + procurement), matching
    // back-schedule's back-pass (start = end - (lead + duration) for all !isPhysical steps).
    // Gating on "procurement" alone drops a lead-bearing decision's lead time and
    // under-projects the finish (e.g. Gate B's B1 decision, lead 7, on every bathroom's path).
    const isPhysical = s.step_type === "site_work" || s.step_type === "inspection";
    const lead = !isPhysical && Number.isFinite(s.lead_time_days) ? Math.max(0, s.lead_time_days) : 0;
    return dur + lead;
  };

  const projected = new Map<string, string>();
  const resolve = (s: ForecastStep, predFinish: string | null): string => {
    if (DONE.has(s.status)) return s.actual_end ?? s.actual_start ?? today;
    if (s.status === "in_progress") {
      const elapsed = s.actual_start ? Math.max(0, daysBetween(s.actual_start, today)) : 0;
      const remaining = Math.max(1, span(s) - elapsed);
      return addDays(maxIso(today, predFinish ?? today), remaining);
    }
    // not_started / blocked / stalled
    const startBasis = s.planned_start ? maxIso(s.planned_start, today) : today;
    const anchor = maxIso(startBasis, predFinish ?? startBasis);
    return addDays(anchor, span(s));
  };

  let guard = applicable.length * applicable.length + 1;
  while (projected.size < applicable.length && guard-- > 0) {
    for (const s of applicable) {
      if (projected.has(s.step_code)) continue;
      const preds = predsOf.get(s.step_code)!;
      if (!preds.every((p) => projected.has(p))) continue;
      const predFinish = preds.length
        ? preds.reduce<string | null>((acc, p) => (acc === null ? projected.get(p)! : maxIso(acc, projected.get(p)!)), null)
        : null;
      projected.set(s.step_code, resolve(s, predFinish));
    }
  }
  // Cycle fallback: resolve stragglers ignoring their (unresolvable) predecessors.
  for (const s of applicable) if (!projected.has(s.step_code)) projected.set(s.step_code, resolve(s, null));

  let projectedFinish: string | null = null;
  for (const v of projected.values()) projectedFinish = projectedFinish ? maxIso(projectedFinish, v) : v;

  const complete = applicable.every((s) => DONE.has(s.status));
  const slipDays = target && projectedFinish ? daysBetween(target, projectedFinish) : null;
  return { target, projectedFinish, slipDays, complete, hasPlan };
}
