import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/** Input schema — usable by web (parses FormData) and mobile (object call). */
export const RejectDraftInput = z.object({
  draftId:    z.string().uuid(),
  rejectorId: z.string().uuid(),
  reason:     z.string().max(500).optional(),
});
export type RejectDraftInputType = z.infer<typeof RejectDraftInput>;

export type RejectDraftResult =
  | { ok: true; projectId: string; draftAuthorId: string | null; eventKind: string }
  | { ok: false; error: string };

/**
 * Core reject logic: update the draft to rejected, guarded by .eq('status','draft').
 * Returns metadata the web wrapper uses for notifyDraftRejected.
 * Does NOT revalidate paths or notify — those are web-only side effects.
 */
export async function rejectCardEventDraft(
  supabase: SupabaseClient<Database>,
  args: RejectDraftInputType,
): Promise<RejectDraftResult> {
  const { draftId, rejectorId, reason } = args;

  const { error } = await supabase
    .from("data_drafts")
    .update({
      status:               "rejected" as Database["public"]["Enums"]["draft_status"],
      rejected_by_staff_id: rejectorId,
      rejected_at:          new Date().toISOString(),
      rejection_reason:     reason ?? null,
    })
    .eq("id", draftId)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  // Fetch author + kind so web wrapper can fire notifyDraftRejected.
  const { data: draft } = await supabase
    .from("data_drafts")
    .select("project_id, created_by_staff_id, proposed_payload")
    .eq("id", draftId)
    .maybeSingle();

  const eventKind = (draft?.proposed_payload as { kind?: string } | null)?.kind ?? "card_event";

  return {
    ok: true,
    projectId: draft?.project_id ?? "",
    draftAuthorId: draft?.created_by_staff_id ?? null,
    eventKind,
  };
}
