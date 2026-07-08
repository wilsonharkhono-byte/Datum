import type { DatumClient } from "../client";
import type { Staff } from "@datum/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectMemberRow = {
  staff_id: string;
  role_on_project: string;
  cost_visible: boolean;
  active_from: string;
  active_until: string | null;
  staff: Pick<Staff, "id" | "full_name" | "role" | "email" | "active"> | null;
};

// ─── Read helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch all project_staff rows for a project (active and inactive).
 * Filter by !active_until to get currently-active members on the client side.
 */
export async function getProjectMembers(
  supabase: DatumClient,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const { data, error } = await supabase
    .from("project_staff")
    .select(`staff_id, role_on_project, cost_visible, active_from, active_until,
             staff:staff_id (id, full_name, role, email, active)`)
    .eq("project_id", projectId)
    .order("active_from", { ascending: true });
  if (error) throw error;
  return (data as unknown as ProjectMemberRow[]) ?? [];
}

/**
 * Fetch all active staff rows (not project-scoped).
 * Use the result with getProjectMembers to compute "addable" candidates.
 */
export async function getAvailableStaff(
  supabase: DatumClient,
): Promise<Pick<Staff, "id" | "full_name" | "role" | "email">[]> {
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name, role, email")
    .eq("active", true)
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as Pick<Staff, "id" | "full_name" | "role" | "email">[];
}
