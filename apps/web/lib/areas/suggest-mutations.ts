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
  try {
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
  } catch (err) {
    // A thrown exception (vs. a handled {ok:false}) reaches Next's server-action
    // boundary, which REDACTS the message in production. Catch it here so the
    // real reason reaches the UI instead of the opaque "error occurred in the
    // Server Components render" digest. Internal staff tool — surfacing the
    // detail to the signed-in principal is intended.
    console.error("[applyAreaProposal] unhandled error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Kesalahan server: ${detail}` };
  }
}
