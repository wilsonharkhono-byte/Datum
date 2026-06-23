/**
 * Board-level deadline derivation. Mirrors getCardNextDeadline
 * (lib/gates/schedule.ts) but computes for ALL cards of a project in one
 * pass, so the board doesn't need a per-card round trip.
 */

export type DeadlineCell = {
  area_id: string;
  gate_code: string;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
};

export type CardDeadline = {
  gateCode: string;
  targetEndDate: string; // YYYY-MM-DD
};

/**
 * For each card: among the unfinished (not_started/in_progress) scheduled
 * cells of its linked areas, pick the soonest window starting today or
 * later; if none upcoming, the earliest overdue cell.
 * `todayIso` is a YYYY-MM-DD string.
 */
export function computeCardDeadlines(
  links: { card_id: string; area_id: string }[],
  cells: DeadlineCell[],
  todayIso: string,
): Map<string, CardDeadline> {
  const cellsByArea = new Map<string, DeadlineCell[]>();
  for (const c of cells) {
    if (!c.target_start_date || !c.target_end_date) continue;
    const arr = cellsByArea.get(c.area_id) ?? [];
    arr.push(c);
    cellsByArea.set(c.area_id, arr);
  }

  const areasByCard = new Map<string, string[]>();
  for (const l of links) {
    const arr = areasByCard.get(l.card_id) ?? [];
    arr.push(l.area_id);
    areasByCard.set(l.card_id, arr);
  }

  const out = new Map<string, CardDeadline>();
  for (const [cardId, areaIds] of areasByCard) {
    const cardCells = areaIds
      .flatMap((a) => cellsByArea.get(a) ?? [])
      .sort((a, b) => a.target_start_date!.localeCompare(b.target_start_date!));
    if (cardCells.length === 0) continue;
    const upcoming = cardCells.find((c) => c.target_start_date! >= todayIso) ?? cardCells[0]!;
    out.set(cardId, { gateCode: upcoming.gate_code, targetEndDate: upcoming.target_end_date! });
  }
  return out;
}
