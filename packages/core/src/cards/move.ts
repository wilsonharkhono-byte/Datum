import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const MoveCardInput = z.object({
  cardId:     z.string().uuid(),
  newTopicId: z.string().uuid(),
  projectId:  z.string().uuid(),
});

export type MoveCardInputType = z.infer<typeof MoveCardInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type MoveCardResult = { ok: true } | { ok: false; error: string };

// ─── Mutation ────────────────────────────────────────────────────────────────

export async function moveCard(
  supabase: SupabaseClient<Database>,
  input: MoveCardInputType,
): Promise<MoveCardResult> {
  // Sanity: the target topic must belong to the same project
  const { data: topic } = await supabase
    .from("topics")
    .select("id, project_id")
    .eq("id", input.newTopicId)
    .maybeSingle();
  if (!topic) return { ok: false, error: "Kolom tujuan tidak ditemukan" };
  if (topic.project_id !== input.projectId) {
    return { ok: false, error: "Kolom tujuan ada di proyek lain" };
  }

  const { error } = await supabase
    .from("cards")
    .update({ topic_id: input.newTopicId })
    .eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
