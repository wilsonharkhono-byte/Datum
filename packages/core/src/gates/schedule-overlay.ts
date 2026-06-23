// Pure schedule math — no "use server", no Supabase. Synchronous helpers for
// re-anchoring per-area gate windows when a PM sets a handover target.

export type ScheduledCell = {
  area_id: string;
  gate_code: string;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
};

// R4 — honest dates. The default schedule (compute_project_schedule) gives every
// area identical kickoff-derived gate windows. When a PM sets a real handover
// target for an area, we re-anchor THAT area's windows so its final gate ends on
// the target, preserving the gates' relative spacing (a pure date translation —
// no scaling, so the active_weeks rhythm stays intact and honest). Areas with no
// target keep their stored kickoff-derived dates exactly. Pure + unit-testable.

/** Highest gate code present in a set of cells (e.g. "H"). Lexicographic max
 *  matches the A–H sort order. Returns null for an empty set. */
function lastGateCode(codes: string[]): string | null {
  let max: string | null = null;
  for (const c of codes) {
    if (max === null || c > max) max = c;
  }
  return max;
}

/** Add `days` (may be negative) to a YYYY-MM-DD date, returning YYYY-MM-DD.
 *  UTC-anchored so it never drifts across DST. */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole-day difference (later − earlier) between two YYYY-MM-DD dates. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Re-anchor each targeted area's gate windows so its final gate (default "H")
 * ends on the area's target_date, shifting all of that area's cells by the same
 * delta to preserve the gates' relative spacing. Pure function.
 *
 * - `targetByArea`: areaId → target_date (YYYY-MM-DD) or null/absent.
 * - An area is overlaid only if it has a target AND a final-gate cell with a
 *   stored target_end_date to anchor against; otherwise its cells pass through
 *   unchanged (we never invent a baseline we can't derive honestly).
 * - Areas without a target are returned byte-for-byte unchanged.
 * - `anchorGate` lets tests pin the final gate explicitly; in production it's
 *   inferred per area as the highest gate code present.
 */
export function overlayAreaTargetDates(
  cells: ScheduledCell[],
  targetByArea: Map<string, string | null>,
  anchorGate?: string,
): ScheduledCell[] {
  // Group indices by area so we can find each area's anchor without re-scanning.
  const byArea = new Map<string, ScheduledCell[]>();
  for (const c of cells) {
    const arr = byArea.get(c.area_id) ?? [];
    arr.push(c);
    byArea.set(c.area_id, arr);
  }

  // Per-area shift delta (in days); areas absent from this map are untouched.
  const deltaByArea = new Map<string, number>();
  for (const [areaId, areaCells] of byArea) {
    const target = targetByArea.get(areaId);
    if (!target) continue; // no real target → keep stored kickoff-derived dates

    const anchorCode =
      anchorGate ?? lastGateCode(areaCells.map((c) => c.gate_code));
    if (!anchorCode) continue;

    const anchorCell = areaCells.find((c) => c.gate_code === anchorCode);
    if (!anchorCell?.target_end_date) continue; // nothing to anchor against

    deltaByArea.set(areaId, daysBetween(anchorCell.target_end_date, target));
  }

  if (deltaByArea.size === 0) return cells;

  return cells.map((c) => {
    const delta = deltaByArea.get(c.area_id);
    if (delta === undefined || delta === 0) return c;
    return {
      ...c,
      target_start_date: c.target_start_date
        ? shiftIsoDate(c.target_start_date, delta)
        : c.target_start_date,
      target_end_date: c.target_end_date
        ? shiftIsoDate(c.target_end_date, delta)
        : c.target_end_date,
    };
  });
}
