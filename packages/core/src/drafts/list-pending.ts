import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/** The shape of a proposed card event inside a draft's proposed_payload. */
export type ProposedCardEvent = {
  kind: string;
  payload: Record<string, unknown>;
  card_id: string;
  occurred_at: string;
  rationale?: string;
};

export type PendingDraft = {
  id: string;
  project_id: string;
  draft_type: string;
  proposed_payload: ProposedCardEvent;
  risk_level: string;
  source_type: string;
  original_input_text: string | null;
  created_at: string;
  created_by_staff_id: string | null;
  projects: { project_code: string; project_name: string } | null;
  created_by: { full_name: string | null } | null;
};

/**
 * List card_event drafts with status='draft' and draft_type='card_event',
 * ordered newest-first, with project + author joins.
 */
export async function listPendingCardEventDrafts(
  supabase: SupabaseClient<Database>,
  opts?: { limit?: number },
): Promise<PendingDraft[]> {
  const limit = opts?.limit ?? 50;

  const { data, error } = await supabase
    .from("data_drafts")
    .select(`
      id, project_id, draft_type, proposed_payload, risk_level, source_type,
      original_input_text, created_at, created_by_staff_id,
      projects:project_id (project_code, project_name),
      created_by:created_by_staff_id (full_name)
    `)
    .eq("status", "draft")
    .eq("draft_type", "card_event")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as unknown as PendingDraft[];
}
