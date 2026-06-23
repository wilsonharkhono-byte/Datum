import type {
  DateWindow, PlannedWindow, TradeStepDep, TradeStepTemplate,
} from "@/lib/steps/types";

const DAY_MS = 86_400_000;

/** Add (or subtract) whole calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Assign a planned window to every step.
 *
 * - site_work / inspection: forward pass. start = max(window.start, latest
 *   planned_end of its site/inspection predecessors); end = start + duration.
 * - decision / procurement: back pass. end = (earliest dependent's planned_start
 *   - 1 day); start = end - (lead_time + duration). Dependents are resolved
 *   transitively so a decision gating a procurement gating site work lands first.
 *
 * Calendar days, no working-day calendar or resource leveling (v1, YAGNI).
 */
export function backScheduleSteps(
  steps: TradeStepTemplate[],
  deps: TradeStepDep[],
  window: DateWindow,
): Map<string, PlannedWindow> {
  const byCode = new Map(steps.map((s) => [s.code, s]));
  const predsOf = new Map<string, string[]>();
  const depsOf = new Map<string, string[]>(); // code -> steps that depend on it
  for (const s of steps) { predsOf.set(s.code, []); depsOf.set(s.code, []); }
  for (const d of deps) {
    if (byCode.has(d.step_code) && byCode.has(d.predecessor_code)) {
      predsOf.get(d.step_code)!.push(d.predecessor_code);
      depsOf.get(d.predecessor_code)!.push(d.step_code);
    }
  }

  const planned = new Map<string, PlannedWindow>();
  const isPhysical = (c: string) => {
    const t = byCode.get(c)!.step_type;
    return t === "site_work" || t === "inspection";
  };

  // Forward pass for physical steps (topological by physical predecessors).
  const physical = steps.filter((s) => isPhysical(s.code));
  const done = new Set<string>();
  let guard = physical.length * physical.length + 1;
  while (done.size < physical.length && guard-- > 0) {
    for (const s of physical) {
      if (done.has(s.code)) continue;
      const physicalPreds = predsOf.get(s.code)!.filter(isPhysical);
      if (!physicalPreds.every((p) => done.has(p))) continue;
      const start = physicalPreds.reduce(
        (acc, p) => maxIso(acc, planned.get(p)!.planned_end),
        window.start,
      );
      planned.set(s.code, { planned_start: start, planned_end: addDays(start, s.typical_duration_days) });
      done.add(s.code);
    }
  }

  // Back pass for decision/procurement steps. Resolve from the earliest planned
  // dependent; iterate so chains (decision -> procurement -> site) converge.
  const upstream = steps.filter((s) => !isPhysical(s.code));
  guard = upstream.length * upstream.length + 1;
  const placed = new Set<string>();
  while (placed.size < upstream.length && guard-- > 0) {
    for (const s of upstream) {
      if (placed.has(s.code)) continue;
      const dependents = depsOf.get(s.code)!;
      // An upstream step that gates nothing has no anchor to back-schedule from;
      // leave it without a planned window rather than reduce() an empty array.
      if (dependents.length === 0) { placed.add(s.code); continue; }
      if (!dependents.every((d) => planned.has(d))) continue; // wait until dependents placed
      const earliestDependentStart = dependents
        .map((d) => planned.get(d)!.planned_start)
        .reduce((a, b) => (a <= b ? a : b));
      const end = addDays(earliestDependentStart, -1);
      const start = addDays(end, -(s.lead_time_days + s.typical_duration_days));
      planned.set(s.code, { planned_start: start, planned_end: end });
      placed.add(s.code);
    }
  }

  return planned;
}
