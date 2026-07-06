/**
 * Pure schedule-health summariser — no Supabase, no React.
 *
 * Rolls the readiness signals + scheduled cells into a small set of numbers the
 * HealthStrip can render as stat pills. Kept pure so it stays unit-testable and
 * cheap to call from a server component.
 *
 * Status vocabulary (from packages/core schedule-overlay + status-style):
 *   not_started | in_progress | ready_for_handoff | blocked | passed | not_applicable
 * "Done" for gate-progress purposes = passed OR ready_for_handoff.
 */

import type { ProjectStepSignalRow } from "@/lib/steps/queries";
import type { ScheduledCell } from "@/lib/gates/schedule";

export type ScheduleHealth = {
  critical: number;
  high: number;
  warning: number;
  total: number;
  nextDeadline: { date: string; areaCount: number; gateCode: string } | null;
  gateProgressPct: number;
};

/** Cell statuses that count as "done" for gate-progress + are excluded from the next-deadline hunt. */
const DONE_STATUSES = new Set(["passed", "ready_for_handoff"]);

export function summarizeSchedule(
  signals: ProjectStepSignalRow[],
  cells: ScheduledCell[],
  today: string,
): ScheduleHealth {
  let critical = 0;
  let high = 0;
  let warning = 0;
  for (const s of signals) {
    if (s.signal.severity === "critical") critical += 1;
    else if (s.signal.severity === "high") high += 1;
    else if (s.signal.severity === "warning") warning += 1;
  }

  // Gate progress: share of cells that are done. not_applicable cells are
  // excluded from the denominator — they can never be "passed", so counting
  // them would understate real progress.
  const scored = cells.filter((c) => c.status !== "not_applicable");
  const done = scored.filter((c) => DONE_STATUSES.has(c.status)).length;
  const gateProgressPct =
    scored.length > 0 ? Math.round((done / scored.length) * 100) : 0;

  // Next deadline: soonest target_end_date >= today among cells that are not
  // yet done. Group by that date so we can report how many areas share it.
  const upcoming = cells.filter(
    (c) =>
      c.target_end_date !== null &&
      c.target_end_date >= today &&
      !DONE_STATUSES.has(c.status),
  );
  let nextDeadline: ScheduleHealth["nextDeadline"] = null;
  if (upcoming.length > 0) {
    let soonest = upcoming[0]!.target_end_date!;
    for (const c of upcoming) {
      if (c.target_end_date! < soonest) soonest = c.target_end_date!;
    }
    const atDate = upcoming.filter((c) => c.target_end_date === soonest);
    const areas = new Set(atDate.map((c) => c.area_id));
    // Report the earliest gate code sharing that deadline (A→H lexicographic).
    let gateCode = atDate[0]!.gate_code;
    for (const c of atDate) {
      if (c.gate_code < gateCode) gateCode = c.gate_code;
    }
    nextDeadline = { date: soonest, areaCount: areas.size, gateCode };
  }

  return {
    critical,
    high,
    warning,
    total: signals.length,
    nextDeadline,
    gateProgressPct,
  };
}
