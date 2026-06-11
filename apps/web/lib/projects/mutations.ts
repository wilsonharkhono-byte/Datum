"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import type { Database } from "@datum/db";

const PROJECT_STATUS = ["design","construction","finishing","handover","closed"] as const;

const CreateProjectInput = z.object({
  projectCode:   z.string().min(2).max(40)
                    .regex(/^[A-Z0-9-]+$/, "Hanya huruf besar, angka, dan tanda hubung"),
  projectName:   z.string().min(1).max(120),
  clientName:    z.string().max(120).optional().nullable(),
  location:      z.string().max(200).optional().nullable(),
  status:        z.enum(PROJECT_STATUS).default("design"),
  targetHandover: z.string().optional().nullable(), // YYYY-MM-DD
  startDate:     z.string().optional().nullable(),
});

export type CreateProjectResult =
  | { ok: true; projectCode: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  let input;
  try {
    input = CreateProjectInput.parse({
      projectCode:   String(formData.get("projectCode") ?? "").trim().toUpperCase(),
      projectName:   String(formData.get("projectName") ?? "").trim(),
      clientName:    formData.get("clientName") || null,
      location:      formData.get("location") || null,
      status:        formData.get("status") || "design",
      targetHandover: formData.get("targetHandover") || null,
      startDate:     formData.get("startDate") || null,
    });
  } catch (e) {
    // Surface Zod issues as field-level
    if (e && typeof e === "object" && "issues" in e) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of (e as { issues: { path: (string|number)[]; message: string }[] }).issues) {
        if (typeof issue.path[0] === "string") fieldErrors[issue.path[0]] = issue.message;
      }
      return { ok: false, error: "Isi data wajib", fieldErrors };
    }
    return { ok: false, error: "Form tidak valid" };
  }

  const creator = await getCurrentStaff();
  if (!canManageAccess(creator)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa membuat proyek baru" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  // Insert project
  const { data: proj, error: pErr } = await supabase.from("projects").insert({
    project_code:    input.projectCode,
    project_name:    input.projectName,
    client_name:     input.clientName,
    location:        input.location,
    status:          input.status,
    target_handover: input.targetHandover,
    kickoff_date:    input.startDate,
    principal_id:    creator.role === "principal" ? user.id : null,
    pic_id:          creator.role === "pic" ? user.id : null,
  }).select("id, project_code").single();
  if (pErr) {
    if (pErr.code === "23505") {
      return { ok: false, error: `Kode proyek "${input.projectCode}" sudah dipakai`, fieldErrors: { projectCode: "Sudah ada" } };
    }
    return { ok: false, error: pErr.message };
  }

  // Add creator to project_staff so they have access (RLS depends on this)
  const { error: psErr } = await supabase.from("project_staff").insert({
    project_id:       proj.id,
    staff_id:         user.id,
    role_on_project:  creator.role,
    active_from:      new Date().toISOString().slice(0, 10),
  });
  if (psErr) {
    // Don't roll back — the project exists; flag for follow-up
    return { ok: false, error: `Proyek dibuat tapi gagal menambahkan Anda sebagai anggota: ${psErr.message}` };
  }

  // The AFTER INSERT trigger on projects auto-seeds the 15-topic taxonomy.

  revalidatePath("/");
  return { ok: true, projectCode: proj.project_code };
}

const UpdateProjectInput = z.object({
  projectId:      z.string().uuid(),
  projectName:    z.string().min(1).max(120).optional(),
  clientName:     z.string().max(120).nullable().optional(),
  location:       z.string().max(200).nullable().optional(),
  status:         z.enum(PROJECT_STATUS).optional(),
  targetHandover: z.string().nullable().optional(),
  kickoffDate:    z.string().nullable().optional(),
});

export type UpdateProjectResult = { ok: true } | { ok: false; error: string };

export async function updateProject(formData: FormData): Promise<UpdateProjectResult> {
  let input;
  try {
    input = UpdateProjectInput.parse({
      projectId:      formData.get("projectId"),
      projectName:    formData.get("projectName") || undefined,
      clientName:     formData.get("clientName") === null ? undefined : (formData.get("clientName") === "" ? null : formData.get("clientName")),
      location:       formData.get("location") === null ? undefined : (formData.get("location") === "" ? null : formData.get("location")),
      status:         formData.get("status") || undefined,
      targetHandover: formData.get("targetHandover") === null ? undefined : (formData.get("targetHandover") === "" ? null : formData.get("targetHandover")),
      kickoffDate:    formData.get("kickoffDate") === null ? undefined : (formData.get("kickoffDate") === "" ? null : formData.get("kickoffDate")),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa mengubah proyek" };
  }

  const supabase = await createSupabaseServerClient();

  const patch: Database["public"]["Tables"]["projects"]["Update"] = {};
  if (input.projectName !== undefined)    patch.project_name = input.projectName;
  if (input.clientName !== undefined)     patch.client_name = input.clientName;
  if (input.location !== undefined)       patch.location = input.location;
  if (input.status !== undefined)         patch.status = input.status;
  if (input.targetHandover !== undefined) patch.target_handover = input.targetHandover;
  if (input.kickoffDate !== undefined)    patch.kickoff_date = input.kickoffDate;

  if (Object.keys(patch).length === 0) return { ok: true };

  const { data: existing } = await supabase
    .from("projects").select("project_code").eq("id", input.projectId).maybeSingle();
  const { error } = await supabase.from("projects").update(patch).eq("id", input.projectId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  if (existing?.project_code) {
    revalidatePath(`/project/${existing.project_code}`);
    revalidatePath(`/project/${existing.project_code}/settings`);
    revalidatePath(`/project/${existing.project_code}/schedule`);
  }
  return { ok: true };
}
