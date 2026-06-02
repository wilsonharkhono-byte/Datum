"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const AddInput = z.object({
  projectId:     z.string().uuid(),
  staffId:       z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
  projectCode:   z.string().min(1),
});

export type MemberMutationResult = { ok: true } | { ok: false; error: string };

export async function addProjectMember(formData: FormData): Promise<MemberMutationResult> {
  let input;
  try {
    input = AddInput.parse({
      projectId:     formData.get("projectId"),
      staffId:       formData.get("staffId"),
      roleOnProject: formData.get("roleOnProject"),
      projectCode:   formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Upsert pattern: if a previously-removed row exists, un-remove it; otherwise insert.
  const { data: existing } = await supabase
    .from("project_staff")
    .select("active_until")
    .eq("project_id", input.projectId)
    .eq("staff_id", input.staffId)
    .eq("role_on_project", input.roleOnProject)
    .maybeSingle();

  let dbErr;
  const today = new Date().toISOString().slice(0, 10);
  if (existing) {
    if (!existing.active_until) {
      return { ok: false, error: "Anggota sudah aktif dengan peran ini" };
    }
    const { error } = await supabase
      .from("project_staff")
      .update({ active_until: null, active_from: today })
      .eq("project_id", input.projectId)
      .eq("staff_id", input.staffId)
      .eq("role_on_project", input.roleOnProject);
    dbErr = error;
  } else {
    const { error } = await supabase.from("project_staff").insert({
      project_id:      input.projectId,
      staff_id:        input.staffId,
      role_on_project: input.roleOnProject,
      active_from:     today,
    });
    dbErr = error;
  }
  if (dbErr) return { ok: false, error: dbErr.message };

  revalidatePath(`/project/${input.projectCode}/members`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}

const RemoveInput = z.object({
  projectId:     z.string().uuid(),
  staffId:       z.string().uuid(),
  roleOnProject: z.string().min(1).max(40),
  projectCode:   z.string().min(1),
});

export async function removeProjectMember(formData: FormData): Promise<MemberMutationResult> {
  let input;
  try {
    input = RemoveInput.parse({
      projectId:     formData.get("projectId"),
      staffId:       formData.get("staffId"),
      roleOnProject: formData.get("roleOnProject"),
      projectCode:   formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("project_staff")
    .update({ active_until: today })
    .eq("project_id", input.projectId)
    .eq("staff_id", input.staffId)
    .eq("role_on_project", input.roleOnProject)
    .is("active_until", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${input.projectCode}/members`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}
