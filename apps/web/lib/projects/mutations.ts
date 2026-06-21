"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import type { Database } from "@datum/db";
import {
  CreateProjectInput,
  type CreateProjectResult,
  createProject as coreCreateProject,
} from "@datum/core";

export type { CreateProjectResult } from "@datum/core";
export { CreateProjectInput };

export async function createProject(formData: FormData): Promise<CreateProjectResult> {
  let input;
  try {
    input = CreateProjectInput.parse({
      projectCode:    String(formData.get("projectCode") ?? "").trim().toUpperCase(),
      projectName:    String(formData.get("projectName") ?? "").trim(),
      clientName:     formData.get("clientName") || null,
      location:       formData.get("location") || null,
      status:         formData.get("status") || "design",
      targetHandover: formData.get("targetHandover") || null,
      startDate:      formData.get("startDate") || null,
    });
  } catch (e) {
    // Surface Zod issues as field-level
    if (e && typeof e === "object" && "issues" in e) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of (e as { issues: { path: (string | number)[]; message: string }[] }).issues) {
        if (typeof issue.path[0] === "string") fieldErrors[issue.path[0]] = issue.message;
      }
      return { ok: false, error: "Isi data wajib", fieldErrors };
    }
    return { ok: false, error: "Form tidak valid" };
  }

  const creator = await getCurrentStaff();
  if (!creator) {
    return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };
  }

  const supabase = await createSupabaseServerClient();
  const result = await coreCreateProject(supabase, input, { id: creator.id, role: creator.role });

  if (result.ok) {
    revalidatePath("/");
  }

  return result;
}

const PROJECT_STATUS = ["design", "construction", "finishing", "handover", "closed"] as const;

const UpdateProjectInput = z.object({
  projectId:       z.string().uuid(),
  projectName:     z.string().min(1).max(120).optional(),
  clientName:      z.string().max(120).nullable().optional(),
  location:        z.string().max(200).nullable().optional(),
  status:          z.enum(PROJECT_STATUS).optional(),
  targetHandover:  z.string().nullable().optional(),
  kickoffDate:     z.string().nullable().optional(),
  coverImagePath:  z.string().nullable().optional(),
  developmentName: z.string().max(120).nullable().optional(),
});

export type UpdateProjectResult = { ok: true } | { ok: false; error: string };

export async function updateProject(formData: FormData): Promise<UpdateProjectResult> {
  let input;
  try {
    input = UpdateProjectInput.parse({
      projectId:       formData.get("projectId"),
      projectName:     formData.get("projectName") || undefined,
      clientName:      formData.get("clientName") === null ? undefined : (formData.get("clientName") === "" ? null : formData.get("clientName")),
      location:        formData.get("location") === null ? undefined : (formData.get("location") === "" ? null : formData.get("location")),
      status:          formData.get("status") || undefined,
      targetHandover:  formData.get("targetHandover") === null ? undefined : (formData.get("targetHandover") === "" ? null : formData.get("targetHandover")),
      kickoffDate:     formData.get("kickoffDate") === null ? undefined : (formData.get("kickoffDate") === "" ? null : formData.get("kickoffDate")),
      coverImagePath:  formData.get("coverImagePath") === null ? undefined : (formData.get("coverImagePath") === "" ? null : formData.get("coverImagePath")),
      developmentName: formData.get("developmentName") === null ? undefined : (formData.get("developmentName") === "" ? null : formData.get("developmentName")),
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

  if (input.coverImagePath !== undefined) patch.cover_image_path = input.coverImagePath;

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
