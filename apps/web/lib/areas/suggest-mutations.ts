"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import {
  applyAreaProposal as coreApplyAreaProposal,
  type ApplyAreaProposalInputType,
  type ApplyAreaProposalResult,
} from "@datum/core";

export type { ApplyAreaProposalResult };

// Re-export the input type for callers that need it.
export type ApplyAreaProposalInput = ApplyAreaProposalInputType & { projectCode: string };

/**
 * Apply an AI area proposal the user has reviewed + trimmed in the UI.
 *
 * Web server action wrapper: injects the server client, auth-gates on staff,
 * delegates to core, then revalidates the affected routes.
 */
export async function applyAreaProposal(
  rawInput: ApplyAreaProposalInput,
): Promise<ApplyAreaProposalResult> {
  // Auth.
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk menerapkan usulan area" };
  }

  const { projectCode, ...coreInput } = rawInput;
  const supabase = await createSupabaseServerClient();

  const result = await coreApplyAreaProposal(supabase, coreInput);

  if (result.ok) {
    revalidatePath(`/project/${projectCode}`);
    revalidatePath(`/project/${projectCode}/schedule`);
    revalidatePath(`/project/${projectCode}/settings`);
  }
  return result;
}
