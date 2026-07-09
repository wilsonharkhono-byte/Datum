import { z } from "zod";
import type { DatumClient } from "../client";

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Input for adding a staff member to a project.
 * Note: projectCode is intentionally omitted — it only drives revalidatePath
 * on the web side. The web wrapper keeps projectCode in its own FormData
 * parse and uses it for revalidation after calling core.
 */
export const AddProjectMemberInput = z.object({
  projectId:     z.string().uuid(),
  staffId:       z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
  costVisible:   z.boolean().optional(),
});

export type AddProjectMemberInputType = z.infer<typeof AddProjectMemberInput>;

export const RemoveProjectMemberInput = z.object({
  projectId:     z.string().uuid(),
  staffId:       z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
});

export type RemoveProjectMemberInputType = z.infer<typeof RemoveProjectMemberInput>;

/**
 * Input for editing an existing (active) membership's role_on_project and/or
 * cost_visible. Targets the currently-active row only — matches the
 * soft-remove semantics of removeProjectMember (active_until IS NULL).
 */
export const UpdateProjectMemberInput = z.object({
  projectId:        z.string().uuid(),
  staffId:          z.string().uuid(),
  roleOnProject:    z.string().min(1).max(40),
  costVisible:      z.boolean(),
});

export type UpdateProjectMemberInputType = z.infer<typeof UpdateProjectMemberInput>;

// ─── Result ───────────────────────────────────────────────────────────────────

export type MemberMutationResult = { ok: true } | { ok: false; error: string };

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Add a staff member to a project.
 *
 * Upsert pattern:
 *   - If a previously-removed row exists (active_until set), un-remove it.
 *   - If an active row exists, return "Anggota sudah aktif dengan peran ini".
 *   - Otherwise, insert a fresh row.
 *
 * Does NOT call revalidatePath — that is handled by the web wrapper.
 */
export async function addProjectMember(
  supabase: DatumClient,
  input: AddProjectMemberInputType,
): Promise<MemberMutationResult> {
  const { data: existing } = await supabase
    .from("project_staff")
    .select("active_until")
    .eq("project_id", input.projectId)
    .eq("staff_id", input.staffId)
    .eq("role_on_project", input.roleOnProject)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);

  if (existing) {
    if (!existing.active_until) {
      return { ok: false, error: "Anggota sudah aktif dengan peran ini" };
    }
    const { error } = await supabase
      .from("project_staff")
      .update({ active_until: null, active_from: today, cost_visible: input.costVisible ?? false })
      .eq("project_id", input.projectId)
      .eq("staff_id", input.staffId)
      .eq("role_on_project", input.roleOnProject);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("project_staff").insert({
      project_id:      input.projectId,
      staff_id:        input.staffId,
      role_on_project: input.roleOnProject,
      cost_visible:    input.costVisible ?? false,
      active_from:     today,
    });
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

/**
 * Soft-remove a staff member from a project by setting active_until = today.
 * Only affects rows where active_until IS NULL (i.e., currently active members).
 *
 * Does NOT call revalidatePath — that is handled by the web wrapper.
 */
export async function removeProjectMember(
  supabase: DatumClient,
  input: RemoveProjectMemberInputType,
): Promise<MemberMutationResult> {
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("project_staff")
    .update({ active_until: today })
    .eq("project_id", input.projectId)
    .eq("staff_id", input.staffId)
    .eq("role_on_project", input.roleOnProject)
    .is("active_until", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Edit an existing membership's role_on_project and/or cost_visible.
 * Targets the currently-active row for (projectId, staffId) — role_on_project
 * is not part of the match here (it's the field being changed), matching the
 * table's actual primary key of (project_id, staff_id).
 *
 * Does NOT call revalidatePath — that is handled by the web wrapper.
 */
export async function updateProjectMember(
  supabase: DatumClient,
  input: UpdateProjectMemberInputType,
): Promise<MemberMutationResult> {
  const { error } = await supabase
    .from("project_staff")
    .update({ role_on_project: input.roleOnProject, cost_visible: input.costVisible })
    .eq("project_id", input.projectId)
    .eq("staff_id", input.staffId)
    .is("active_until", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
