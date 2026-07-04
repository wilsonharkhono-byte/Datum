"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recomputeProjectGates as coreRecomputeProjectGates } from "@datum/core";

// NOTE: recomputeProjectGates (the JS rule engine) is NOT web-only — its body
// lives in @datum/core/gates/recompute. This wrapper adds auth + revalidatePath.
// Mobile calls core.recomputeProjectGates directly (no revalidatePath needed).

const RecomputeInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
});

export type RecomputeResult =
  | { ok: true; cellsUpdated: number; ruleVersion: number }
  | { ok: false; error: string };

export async function recomputeAreaGateStatus(formData: FormData): Promise<RecomputeResult> {
  let input;
  try {
    input = RecomputeInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  return recomputeProjectGates(input.projectId, input.projectCode);
}

/**
 * Project-wide recompute of every (area, gate) cell. Shared by the manual
 * button above and the fire-and-forget trigger after gate-relevant
 * card_event inserts (lib/cards/mutations.ts createCardEvent).
 *
 * After a gate mutation, mobile won't call this directly — cron/realtime
 * covers invalidation. The web wrapper calls revalidatePath; mobile does not.
 */
export async function recomputeProjectGates(
  projectId:   string,
  projectCode: string,
): Promise<RecomputeResult> {
  const supabase = await createSupabaseServerClient();
  const result = await coreRecomputeProjectGates(supabase, projectId, projectCode);
  if (result.ok) {
    revalidatePath(`/project/${projectCode}/schedule`);
  }
  return result;
}

// NOTE: recomputeProjectGatesSystem (admin-client + skipAuthCheck variant for
// use inside after() background callbacks with no end-user session) lives in
// lib/gates/recompute-system.ts, NOT here — this file is "use server" and
// every export becomes a client-callable action; that variant must never be
// client-reachable. See recompute-system.ts's header comment.
