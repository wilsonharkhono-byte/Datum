import { z } from "zod";
import type { DatumClient } from "../client";
import type { Database } from "@datum/db";

// ─── Shared status enum (imported by create.ts too; defined inline here to
//     avoid a circular dep — both modules export it, consumers import from
//     whichever they already depend on). ─────────────────────────────────────
export const PROJECT_STATUS = [
  "design",
  "construction",
  "finishing",
  "handover",
  "closed",
] as const;

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Patch-style input: only provide fields you want to update.
 * Pass null to clear an optional field (clientName, location, dates).
 * coverImagePath is supported so the landing-slice cover-upload
 * can call this without a separate mutation.
 */
export const UpdateProjectInput = z.object({
  projectId:       z.string().uuid(),
  projectName:     z.string().min(1).max(120).optional(),
  clientName:      z.string().max(120).nullable().optional(),
  location:        z.string().max(200).nullable().optional(),
  status:          z.enum(PROJECT_STATUS).optional(),
  targetHandover:  z.string().nullable().optional(), // YYYY-MM-DD
  kickoffDate:     z.string().nullable().optional(), // YYYY-MM-DD — triggers schedule recalc server-side
  coverImagePath:  z.string().nullable().optional(),
  developmentName: z.string().max(120).nullable().optional(),
});

export type UpdateProjectInputType = z.infer<typeof UpdateProjectInput>;

// ─── Result ───────────────────────────────────────────────────────────────────

export type UpdateProjectResult = { ok: true } | { ok: false; error: string };

// ─── Mutation ────────────────────────────────────────────────────────────────

/**
 * Patch a project's editable fields.
 *
 * - Only fields present in `input` are written (patch semantics).
 * - `developmentName`: null clears the development_id; a string resolves or
 *   creates a developments row and sets development_id.
 * - Empty patch (no fields except projectId) returns {ok: true} immediately.
 * - Does NOT call revalidatePath — the web wrapper handles that.
 * - canManageAccess must be checked by the caller before invoking.
 */
export async function updateProject(
  supabase: DatumClient,
  input: UpdateProjectInputType,
): Promise<UpdateProjectResult> {
  // Build the patch object with only the fields that were provided.
  const patch: Database["public"]["Tables"]["projects"]["Update"] = {};
  if (input.projectName !== undefined)    patch.project_name = input.projectName;
  if (input.clientName !== undefined)     patch.client_name = input.clientName;
  if (input.location !== undefined)       patch.location = input.location;
  if (input.status !== undefined)         patch.status = input.status;
  if (input.targetHandover !== undefined) patch.target_handover = input.targetHandover;
  if (input.kickoffDate !== undefined)    patch.kickoff_date = input.kickoffDate;
  if (input.coverImagePath !== undefined) patch.cover_image_path = input.coverImagePath;

  // Resolve developmentName → development_id
  if (input.developmentName !== undefined) {
    if (input.developmentName === null) {
      patch.development_id = null;
    } else {
      const name = input.developmentName.trim();
      const { data: found } = await supabase
        .from("developments")
        .select("id")
        .ilike("name", name)
        .maybeSingle();
      if (found) {
        patch.development_id = found.id;
      } else {
        const { data: created, error: cErr } = await supabase
          .from("developments")
          .insert({ name })
          .select("id")
          .single();
        if (cErr) return { ok: false, error: cErr.message };
        patch.development_id = created.id;
      }
    }
  }

  // Empty patch — nothing to do
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", input.projectId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
