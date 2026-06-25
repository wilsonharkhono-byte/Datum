import type { GateCode } from "@datum/types";
import type { DatumClient } from "../client";
import { fetchMatrix } from "../matrix/fetch-matrix";
import {
  blockerCount,
  deriveStage,
  isHandoverReady,
  nextAction,
  sortRoomsByUrgency,
  type Room,
  type RoomGateCell,
} from "./derive";

export type { Room } from "./derive";

export type ProjectRooms = {
  projectId: string;
  projectCode: string;
  projectName: string;
  rooms: Room[];
};

/**
 * Assemble one row per area for a project's "Ruangan" surface.
 *
 * Reuses fetchMatrix (areas + per-area×gate cells already computed by the rule
 * engine) and a single card_areas→cards join for activity. RLS on areas /
 * area_gate_status / card_areas / cards scopes everything to the caller's
 * session — no extra authorization here. Returns null when the project_code
 * does not resolve (mirrors the schedule page's not-found branch).
 *
 * `sb` is the caller-injected DatumClient (server or anon, per platform).
 */
export async function getProjectRooms(
  sb: DatumClient,
  slug: string,
): Promise<ProjectRooms | null> {
  const { data: project } = await sb
    .from("projects")
    .select("id, project_code, project_name")
    .eq("project_code", slug.toUpperCase())
    .maybeSingle();
  if (!project) return null;

  const matrix = await fetchMatrix(sb, project.id);
  if (!matrix) return null;

  // Cells grouped per area (the matrix Map is keyed `${area_id}|${gate}`).
  const cellsByArea = new Map<string, RoomGateCell[]>();
  for (const cell of matrix.cells.values()) {
    const arr = cellsByArea.get(cell.area_id) ?? [];
    arr.push({ gate_code: cell.gate_code as GateCode, status: cell.status });
    cellsByArea.set(cell.area_id, arr);
  }

  // Per-area card activity: how many cards link to the area and the freshest
  // last_event_at among them. One join keeps this to a single round-trip.
  const areaIds = matrix.areas.map((a) => a.id);
  const cardCountByArea = new Map<string, number>();
  const lastActivityByArea = new Map<string, string>();
  if (areaIds.length > 0) {
    const { data: links } = await sb
      .from("card_areas")
      .select("area_id, cards:card_id (last_event_at)")
      .in("area_id", areaIds);
    for (const row of links ?? []) {
      const areaId = (row as { area_id: string }).area_id;
      cardCountByArea.set(areaId, (cardCountByArea.get(areaId) ?? 0) + 1);
      const lastEventAt = (row as { cards: { last_event_at: string | null } | null }).cards
        ?.last_event_at;
      if (lastEventAt) {
        const prev = lastActivityByArea.get(areaId);
        if (!prev || lastEventAt > prev) lastActivityByArea.set(areaId, lastEventAt);
      }
    }
  }

  const rooms: Room[] = matrix.areas.map((area) => {
    const cells = cellsByArea.get(area.id) ?? [];
    const stage = deriveStage(cells);
    const blockers = blockerCount(cells);
    const activeCards = cardCountByArea.get(area.id) ?? 0;
    const handoverReady = isHandoverReady(cells, stage);
    return {
      areaId: area.id,
      areaCode: area.area_code,
      areaName: area.area_name,
      areaType: area.area_type,
      floor: area.floor,
      sortOrder: area.sort_order,
      stage,
      blockers,
      activeCards,
      lastActivityAt: lastActivityByArea.get(area.id) ?? null,
      handoverReady,
      action: nextAction(stage, blockers, activeCards, handoverReady),
    };
  });

  return {
    projectId: project.id,
    projectCode: project.project_code,
    projectName: project.project_name,
    rooms: sortRoomsByUrgency(rooms),
  };
}
