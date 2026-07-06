import type {
  DateWindow, PlannedWindow, TradeStepDep, TradeStepTemplate,
} from "@/lib/steps/types";

const DAY_MS = 86_400_000;

/** Add (or subtract) whole calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole-day difference (later − earlier) between two YYYY-MM-DD dates. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / DAY_MS);
}

/**
 * Assign a planned window to every step.
 *
 * - site_work / inspection: forward pass in day-offsets from window.start
 *   (start = latest end of physical predecessors; end = start + duration),
 *   then the whole chain is DILATED to fill the gate window: every offset is
 *   scaled by windowDays / chainDays (only when the window is longer than the
 *   chain). A gate window is a span of weeks, not a sprint — without dilation
 *   every step bunches at the window start, each step's window is only its
 *   typical duration, and every reminder for the gate fires at once. With it,
 *   steps share the window proportionally and the last physical step ends on
 *   window.end, which is also what anchors area handover targets (gate H ends
 *   on the target).
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

  // Forward pass for physical steps (topological by physical predecessors),
  // in whole-day offsets from window.start.
  const startOff = new Map<string, number>();
  const endOff = new Map<string, number>();
  const physical = steps.filter((s) => isPhysical(s.code));
  const done = new Set<string>();
  let guard = physical.length * physical.length + 1;
  while (done.size < physical.length && guard-- > 0) {
    for (const s of physical) {
      if (done.has(s.code)) continue;
      const physicalPreds = predsOf.get(s.code)!.filter(isPhysical);
      if (!physicalPreds.every((p) => done.has(p))) continue;
      const start = physicalPreds.reduce((acc, p) => Math.max(acc, endOff.get(p)!), 0);
      startOff.set(s.code, start);
      endOff.set(s.code, start + s.typical_duration_days);
      done.add(s.code);
    }
  }

  // Dilate the chain onto the window (never compress: factor >= 1, so a window
  // shorter than the chain keeps honest overrun past window.end). Math.round on
  // monotone offsets keeps successor starts aligned with predecessor ends.
  const chainDays = Math.max(0, ...endOff.values());
  const windowDays = daysBetween(window.start, window.end);
  const factor = chainDays > 0 && windowDays > chainDays ? windowDays / chainDays : 1;
  for (const s of physical) {
    if (!startOff.has(s.code)) continue; // unresolved (cyclic deps) — skip
    planned.set(s.code, {
      planned_start: addDays(window.start, Math.round(startOff.get(s.code)! * factor)),
      planned_end: addDays(window.start, Math.round(endOff.get(s.code)! * factor)),
    });
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
