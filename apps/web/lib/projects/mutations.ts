"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import {
  CreateProjectInput,
  type CreateProjectResult,
  createProject as coreCreateProject,
  UpdateProjectInput,
  type UpdateProjectResult,
  updateProject as coreUpdateProject,
  getProjectCodeById,
} from "@datum/core";
import { cascadePlannedDates } from "@/lib/steps/mutations";

export type { CreateProjectResult } from "@datum/core";
export type { UpdateProjectResult } from "@datum/core";
// NOTE: CreateProjectInput (a Zod value) is NOT re-exported — a "use server" file
// may only export async functions. Import it from "@datum/core" directly.

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

export async function updateProject(formData: FormData): Promise<UpdateProjectResult> {
  let input;
  try {
    input = UpdateProjectInput.parse({
      projectId:       formData.get("projectId"),
      projectCode:     formData.get("projectCode") ? String(formData.get("projectCode")).trim().toUpperCase() : undefined,
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

  // Fetch the project_code for revalidation *before* the update
  const existingCode = await getProjectCodeById(supabase, input.projectId);

  // Pre-read kickoff so the (expensive) planned-dates cascade below only runs
  // when the kickoff actually moved — the settings form always submits the
  // field, changed or not.
  let previousKickoff: string | null = null;
  if (input.kickoffDate !== undefined) {
    const { data: prev } = await supabase
      .from("projects").select("kickoff_date").eq("id", input.projectId).maybeSingle();
    previousKickoff = prev?.kickoff_date ?? null;
  }

  const result = await coreUpdateProject(supabase, input);

  if (result.ok) {
    if (input.kickoffDate !== undefined && input.kickoffDate !== previousKickoff) {
      // The DB trigger already recomputed area_gate_status windows inside the
      // UPDATE; cascade them onto area_steps.planned_* so step reminders track
      // the new kickoff instead of the schedule the areas were created under.
      await cascadePlannedDates(supabase, input.projectId);
    }
    revalidatePath("/");
    // Revalidate both the old and (if renamed) the new code's paths so neither
    // the stale nor the fresh URL serves a cached copy.
    const codes = new Set<string>();
    if (existingCode) codes.add(existingCode);
    if (input.projectCode) codes.add(input.projectCode);
    for (const code of codes) {
      revalidatePath(`/project/${code}`);
      revalidatePath(`/project/${code}/settings`);
      revalidatePath(`/project/${code}/schedule`);
    }
  }

  return result;
}
