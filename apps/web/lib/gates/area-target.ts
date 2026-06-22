"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/get-current-user";
import { setAreaTargetDate as coreSetAreaTargetDate } from "@datum/core";

// Re-export types + schema from core so existing web importers are unbroken.
export { TargetInput, type TargetInputType, type AreaTargetResult } from "@datum/core";

/**
 * R4 — set (or clear) the honest handover target for a single area.
 * Web wrapper: resolves staff + revalidates paths. Core handles the DB write.
 * Mobile calls core.setAreaTargetDate directly with the session staffId.
 */
export async function setAreaTargetDate(input: {
  areaId: string;
  projectId: string;
  targetDate: string | null;
}): Promise<import("@datum/core").AreaTargetResult> {
  // Auth — must be a known staff member.
  const staff = await getCurrentStaff();
  if (!staff) {
    return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };
  }

  const supabase = await createSupabaseServerClient();
  const result = await coreSetAreaTargetDate(supabase, staff.id, input);

  if (result.ok) {
    // Re-baselining shifts derived gate windows → refresh schedule + board.
    // We need the project_code for the path. Re-query it (RLS already checked
    // inside core, so this is safe and cheap).
    const { data: project } = await supabase
      .from("projects")
      .select("project_code")
      .eq("id", input.projectId)
      .maybeSingle();
    if (project) {
      revalidatePath(`/project/${project.project_code}/schedule`);
      revalidatePath(`/project/${project.project_code}`);
    }
  }

  return result;
}
