"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import {
  markGatePassed as coreMarkGatePassed,
  getGateCheckpoints as coreGetGateCheckpoints,
} from "@datum/core";

// Re-export types + schemas from core so existing web importers are unbroken.
export {
  MarkGatePassedInput,
  ADVANCEABLE,
  type MarkGatePassedInput as MarkGatePassedInputType,
  type MarkGatePassedResult,
  type GateCheckpoint,
} from "@datum/core";

/**
 * The seeded Lampiran-A QA items for one gate. Thin wrapper over core.
 */
export async function getGateCheckpoints(gateCode: string) {
  const supabase = await createSupabaseServerClient();
  return coreGetGateCheckpoints(supabase, gateCode);
}

/**
 * Advance a gate cell to passed. Web wrapper: resolves staff + revalidates.
 * Mobile calls core.markGatePassed directly with the session staffId.
 *
 * After mobile gate mutation, web revalidatePath is NOT called — mobile
 * relies on cron/realtime + react-query invalidation.
 */
export async function markGatePassed(
  raw: import("@datum/core").MarkGatePassedInputType,
): Promise<import("@datum/core").MarkGatePassedResult> {
  // Auth: must be signed-in staff.
  const staff = await getCurrentStaff();
  if (!staff) {
    return { ok: false, error: "Harus masuk untuk menandai gate selesai" };
  }

  const supabase = await createSupabaseServerClient();
  const result = await coreMarkGatePassed(supabase, staff.id, raw);

  if (result.ok) {
    // Refresh every surface that reads gate status.
    const sb2 = await createSupabaseServerClient();
    const { data: proj } = await sb2
      .from("projects")
      .select("project_code")
      .eq("id", (raw as { projectId: string }).projectId)
      .maybeSingle();
    const code = proj?.project_code;
    if (code) {
      revalidatePath(`/project/${code}/schedule`);
      revalidatePath(`/project/${code}/rooms`);
      revalidatePath(`/project/${code}`);
    }
    revalidatePath("/brief");
  }

  return result;
}
