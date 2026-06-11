/**
 * Bottleneck detection — pure functions over schedule cells and vendor
 * events, so the rules are unit-testable without a database.
 */

export type ScheduleCell = {
  project_code: string;
  project_name: string;
  area_id: string;
  area_name: string;
  gate_code: string;
  status: string;
  target_start_date: string | null; // YYYY-MM-DD
  target_end_date: string | null;
};

export type GateRisk = {
  projectCode: string;
  areaName: string;
  gateCode: string;
  reason: string;
};

const GATE_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const SATISFIED = new Set(["passed", "ready_for_handoff", "not_applicable"]);

/**
 * Cascade rule: gate N's target window has started, but gate N-1 in the
 * same area is not yet satisfied → downstream slip risk.
 */
export function findCascadeRisks(cells: ScheduleCell[], todayIso: string): GateRisk[] {
  const byArea = new Map<string, ScheduleCell[]>();
  for (const c of cells) {
    const arr = byArea.get(c.area_id) ?? [];
    arr.push(c);
    byArea.set(c.area_id, arr);
  }

  const risks: GateRisk[] = [];
  for (const areaCells of byArea.values()) {
    const byGate = new Map(areaCells.map((c) => [c.gate_code, c]));
    for (let i = 1; i < GATE_ORDER.length; i++) {
      const cur = byGate.get(GATE_ORDER[i]!);
      const prev = byGate.get(GATE_ORDER[i - 1]!);
      if (!cur || !prev) continue;
      if (cur.status === "not_applicable") continue;
      const windowStarted = cur.target_start_date != null && cur.target_start_date <= todayIso;
      if (windowStarted && !SATISFIED.has(prev.status)) {
        risks.push({
          projectCode: cur.project_code,
          areaName: cur.area_name,
          gateCode: cur.gate_code,
          reason: `Gate ${cur.gate_code} sudah masuk jadwal, tapi Gate ${prev.gate_code} belum siap (${prev.status})`,
        });
      }
    }
  }
  return risks;
}

export type QuoteEvent = {
  id: string;
  card_id: string;
  occurred_at: string | null;
  payload: { vendor_name?: string; expires_at?: string; interaction?: string };
};

/**
 * Quotes expiring within `windowDays` (or already expired) on cards where
 * no vendor has been picked/contracted yet.
 */
export function findExpiringQuotes(
  vendorEvents: QuoteEvent[],
  todayIso: string,
  windowDays = 7,
): QuoteEvent[] {
  const horizon = new Date(new Date(todayIso).getTime() + windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const decidedCards = new Set(
    vendorEvents
      .filter((e) => e.payload.interaction === "pick" || e.payload.interaction === "contract")
      .map((e) => e.card_id),
  );
  return vendorEvents.filter(
    (e) =>
      e.payload.interaction === "quote" &&
      typeof e.payload.expires_at === "string" &&
      e.payload.expires_at <= horizon &&
      !decidedCards.has(e.card_id),
  );
}
