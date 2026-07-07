import type { GateCode } from "@datum/types";
import { GateCodes } from "@datum/types";
import type { DatumClient } from "../client";
import { must } from "../db/must";

export type MatrixCell = {
  project_id: string;
  area_id: string;
  gate_code: GateCode;
  status: "not_started" | "in_progress" | "ready_for_handoff" | "blocked" | "passed" | "not_applicable";
  blocking_reason: string | null;
  current_owner_id: string | null;
};

export type MatrixArea = {
  id: string;
  area_code: string;
  area_name: string;
  floor: string | null;
  sort_order: number;
  area_type: string;
};

export type MatrixData = {
  project_id: string;
  project_code: string;
  project_name: string;
  areas: MatrixArea[];
  gates: GateCode[];
  cells: Map<string, MatrixCell>;
};

/**
 * Fetches the full area × gate readiness matrix for a project.
 * Shared between the mobile schedule screen and the matrix slice.
 * Returns null if the project is not found / not accessible.
 */
export async function fetchMatrix(
  sb: DatumClient,
  projectId: string,
): Promise<MatrixData | null> {
  const { data: project, error: projErr } = await sb
    .from("projects")
    .select("id, project_code, project_name")
    .eq("id", projectId)
    .single();
  // PGRST116 = no row: genuinely not found / hidden by RLS → null. Any other
  // error must NOT render as "project not accessible" — surface it.
  if (projErr && projErr.code !== "PGRST116") {
    throw new Error(`[db] matrix.project: ${projErr.message}`);
  }
  if (!project) return null;

  const { data: areaRows } = must(
    await sb
      .from("areas")
      .select("id, area_code, area_name, floor, sort_order, area_type")
      .eq("project_id", projectId)
      .order("sort_order"),
    "matrix.areas",
  );

  const { data: cellRows } = must(
    await sb
      .from("area_gate_status")
      .select("project_id, area_id, gate_code, status, blocking_reason, current_owner_id")
      .eq("project_id", projectId),
    "matrix.cells",
  );

  const cells = new Map<string, MatrixCell>();
  for (const c of cellRows ?? []) {
    cells.set(`${c.area_id}|${c.gate_code}`, c as MatrixCell);
  }

  return {
    project_id: project.id,
    project_code: project.project_code,
    project_name: project.project_name,
    areas: (areaRows ?? []) as MatrixArea[],
    gates: [...GateCodes],
    cells,
  };
}
