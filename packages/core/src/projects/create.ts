import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { canManageRole, type StaffRole } from "../auth/current-staff";

// ─── Schema ───────────────────────────────────────────────────────────────────

const PROJECT_STATUS = ["design", "construction", "finishing", "handover", "closed"] as const;

export const CreateProjectInput = z.object({
  projectCode: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9-]+$/, "Hanya huruf besar, angka, dan tanda hubung"),
  projectName:    z.string().min(1).max(120),
  clientName:     z.string().max(120).optional().nullable(),
  location:       z.string().max(200).optional().nullable(),
  status:         z.enum(PROJECT_STATUS).default("design"),
  targetHandover: z.string().optional().nullable(), // YYYY-MM-DD
  startDate:      z.string().optional().nullable(),
});

export type CreateProjectInputType = z.infer<typeof CreateProjectInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type CreateProjectResult =
  | { ok: true; projectCode: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

// ─── Mutation ────────────────────────────────────────────────────────────────

/**
 * Create a new project.
 *
 * Caller resolution is the responsibility of the host (web: via getCurrentStaff +
 * session user; mobile: via the session staff row). Core receives only the
 * trimmed { id, role } to remain server-free.
 *
 * Does NOT call revalidatePath / redirect — those are web-only side effects
 * handled by the thin web wrapper.
 */
export async function createProject(
  supabase: SupabaseClient<Database>,
  input: CreateProjectInputType,
  caller: { id: string; role: StaffRole },
): Promise<CreateProjectResult> {
  // Role gate
  if (!canManageRole(caller.role)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa membuat proyek baru" };
  }

  // Insert project
  const { data: proj, error: pErr } = await supabase
    .from("projects")
    .insert({
      project_code:    input.projectCode,
      project_name:    input.projectName,
      client_name:     input.clientName ?? null,
      location:        input.location ?? null,
      status:          input.status,
      target_handover: input.targetHandover ?? null,
      kickoff_date:    input.startDate ?? null,
      principal_id:    caller.role === "principal" ? caller.id : null,
      pic_id:          caller.role === "pic" ? caller.id : null,
    })
    .select("id, project_code")
    .single();

  if (pErr) {
    if (pErr.code === "23505") {
      return {
        ok: false,
        error: `Kode proyek "${input.projectCode}" sudah dipakai`,
        fieldErrors: { projectCode: "Sudah ada" },
      };
    }
    return { ok: false, error: pErr.message };
  }

  // Add creator to project_staff so they have access (RLS depends on this)
  const { error: psErr } = await supabase.from("project_staff").insert({
    project_id:      proj.id,
    staff_id:        caller.id,
    role_on_project: caller.role,
    active_from:     new Date().toISOString().slice(0, 10),
  });

  if (psErr) {
    // Don't roll back — the project exists; flag for follow-up
    return {
      ok: false,
      error: `Proyek dibuat tapi gagal menambahkan Anda sebagai anggota: ${psErr.message}`,
    };
  }

  // The AFTER INSERT trigger on projects auto-seeds the 15-topic taxonomy.

  return { ok: true, projectCode: proj.project_code };
}
