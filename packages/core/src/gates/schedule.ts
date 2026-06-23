import type { DatumClient } from "../client";
import { overlayAreaTargetDates, type ScheduledCell } from "./schedule-overlay";

export type { ScheduledCell };

export type NextDeadline = {
  gateCode: string;
  gateName: string;
  targetStartDate: string;
  targetEndDate: string;
  areaCount: number;
};

/**
 * All (area × gate) cells for a project, with per-area target overlays applied.
 * Corresponds to web's schedule.ts:getProjectScheduleCells minus the implicit
 * server client creation.
 */
export async function getProjectScheduleCells(
  sb: DatumClient,
  projectId: string,
): Promise<ScheduledCell[]> {
  const [{ data: cellRows }, { data: areaRows }] = await Promise.all([
    sb
      .from("area_gate_status")
      .select("area_id, gate_code, status, target_start_date, target_end_date, actual_start_date, actual_end_date")
      .eq("project_id", projectId),
    sb
      .from("areas")
      .select("id, target_date")
      .eq("project_id", projectId),
  ]);

  const cells = (cellRows ?? []) as ScheduledCell[];

  // Overlay honest per-area targets onto the stored kickoff-derived windows.
  const targetByArea = new Map<string, string | null>();
  for (const a of areaRows ?? []) {
    targetByArea.set(a.id, a.target_date);
  }
  return overlayAreaTargetDates(cells, targetByArea);
}

/** Areas of a project that carry a real PM-set target (re-baselined), so the
 *  UI can distinguish them from areas still on the default kickoff schedule. */
export async function getAreaTargetDates(
  sb: DatumClient,
  projectId: string,
): Promise<Map<string, string>> {
  const { data } = await sb
    .from("areas")
    .select("id, target_date")
    .eq("project_id", projectId);
  const out = new Map<string, string>();
  for (const a of data ?? []) {
    if (a.target_date) out.set(a.id, a.target_date);
  }
  return out;
}

/**
 * Per-card next deadline: from the card's linked areas, find the soonest
 * upcoming (target_start_date >= today) where status is 'not_started' OR
 * 'in_progress'. Returns null if no upcoming deadline.
 */
export async function getCardNextDeadline(
  sb: DatumClient,
  cardId: string,
): Promise<NextDeadline | null> {
  // 1. The areas this card is linked to
  const { data: cardAreas } = await sb
    .from("card_areas").select("area_id").eq("card_id", cardId);
  if (!cardAreas || cardAreas.length === 0) return null;
  const areaIds = cardAreas.map((r) => r.area_id);

  // 2. The status rows for those areas across all gates
  const { data: cells } = await sb
    .from("area_gate_status")
    .select("gate_code, target_start_date, target_end_date, status")
    .in("area_id", areaIds)
    .in("status", ["not_started", "in_progress"])
    .not("target_start_date", "is", null)
    .order("target_start_date", { ascending: true });

  if (!cells || cells.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = cells.find((c) => c.target_start_date && c.target_start_date >= today) ?? cells[0];
  if (!upcoming) return null;

  // 3. Get the gate's display name
  const { data: gate } = await sb
    .from("gates").select("name").eq("code", upcoming.gate_code).maybeSingle();

  // Count how many of the card's areas share this gate window
  const sameGateAreas = cells.filter((c) => c.gate_code === upcoming.gate_code);

  return {
    gateCode: upcoming.gate_code,
    gateName: gate?.name ?? upcoming.gate_code,
    targetStartDate: upcoming.target_start_date!,
    targetEndDate: upcoming.target_end_date!,
    areaCount: sameGateAreas.length,
  };
}
