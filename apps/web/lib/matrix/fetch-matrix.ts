import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GateCode } from "@datum/types";
import { GateCodes } from "@datum/types";

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
};

export type MatrixData = {
  project_id: string;
  project_code: string;
  project_name: string;
  areas: MatrixArea[];
  gates: GateCode[];
  cells: Map<string, MatrixCell>;
};

export async function fetchMatrix(projectId: string): Promise<MatrixData | null> {
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_code, project_name")
    .eq("id", projectId)
    .single();
  if (!project) return null;

  const { data: areaRows } = await supabase
    .from("areas")
    .select("id, area_code, area_name, floor, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");

  const { data: cellRows } = await supabase
    .from("area_gate_status")
    .select("project_id, area_id, gate_code, status, blocking_reason, current_owner_id")
    .eq("project_id", projectId);

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
