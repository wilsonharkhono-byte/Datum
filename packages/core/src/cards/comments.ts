import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

type SC = SupabaseClient<Database>;

// ─── Zod schemas (exported for callers that do their own FormData parsing) ─────

export const CreateCommentInput = z.object({
  cardId:             z.string().uuid(),
  projectId:          z.string().uuid(),
  body:               z.string().min(1).max(4000),
  createdByStaffId:   z.string().uuid(),
});
export type CreateCommentInputType = z.infer<typeof CreateCommentInput>;

export const EditCommentInput = z.object({
  commentId: z.string().uuid(),
  body:      z.string().min(1).max(4000),
});
export type EditCommentInputType = z.infer<typeof EditCommentInput>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type CreateCommentResult =
  | { ok: true; commentId: string; mentions: string[] }
  | { ok: false; error: string };

export type EditCommentResult =
  | { ok: true; cardId: string; projectId: string; mentions: string[] }
  | { ok: false; error: string };

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Mention helpers ──────────────────────────────────────────────────────────

/**
 * Pure: extract all @<first-name> tokens from a comment body.
 * Returns lowercase, deduplicated tokens (the leading @ is stripped).
 */
export function extractMentionTokens(body: string): string[] {
  return Array.from(new Set(
    (body.match(/@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g) ?? [])
      .map((m) => m.slice(1).toLowerCase()),
  ));
}

/**
 * Resolve mention tokens to active staff IDs by case-insensitive first-name match.
 * Requires a Supabase client (reads the `staff` table).
 */
export async function resolveMentionStaffIds(
  supabase: SC,
  tokens: string[],
): Promise<string[]> {
  if (tokens.length === 0) return [];
  const { data: candidates } = await supabase
    .from("staff")
    .select("id, full_name")
    .eq("active", true);
  const ids = new Set<string>();
  for (const cand of candidates ?? []) {
    const first = (cand.full_name ?? "").split(/\s+/)[0]?.toLowerCase();
    if (first && tokens.includes(first)) ids.add(cand.id);
  }
  return Array.from(ids);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Insert a new card comment (with resolved @mentions array).
 * Returns the new commentId + the resolved mentionedStaffIds so the caller can
 * fire notifications.
 */
export async function createComment(
  supabase: SC,
  args: {
    cardId:           string;
    projectId:        string;
    body:             string;
    createdByStaffId: string;
  },
): Promise<CreateCommentResult> {
  const parsed = CreateCommentInput.safeParse({
    cardId:           args.cardId,
    projectId:        args.projectId,
    body:             args.body,
    createdByStaffId: args.createdByStaffId,
  });
  if (!parsed.success) return { ok: false, error: "Komentar tidak boleh kosong" };

  const tokens = extractMentionTokens(args.body);
  const mentionedStaffIds = await resolveMentionStaffIds(supabase, tokens);

  const { data: inserted, error } = await supabase
    .from("card_comments")
    .insert({
      card_id:             args.cardId,
      project_id:          args.projectId,
      body:                args.body,
      mentions:            mentionedStaffIds,
      created_by_staff_id: args.createdByStaffId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (!inserted?.id) return { ok: false, error: "Komentar gagal disimpan" };

  return { ok: true, commentId: inserted.id, mentions: mentionedStaffIds };
}

/**
 * Edit a card comment body (re-parses @mentions, stamps edited_at).
 * Returns the card_id + project_id from the DB row so the caller can
 * fire notifications without knowing them in advance.
 */
export async function editComment(
  supabase: SC,
  args: {
    commentId: string;
    body:      string;
  },
): Promise<EditCommentResult> {
  const parsed = EditCommentInput.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };

  const tokens = extractMentionTokens(args.body);
  const mentionedStaffIds = await resolveMentionStaffIds(supabase, tokens);

  const { data: updated, error } = await supabase
    .from("card_comments")
    .update({
      body:      args.body,
      edited_at: new Date().toISOString(),
      mentions:  mentionedStaffIds,
    })
    .eq("id", args.commentId)
    .select("id, card_id, project_id")
    .single();
  if (error) return { ok: false, error: error.message };
  if (!updated?.card_id || !updated?.project_id) {
    return { ok: false, error: "Komentar tidak ditemukan" };
  }

  return {
    ok:        true,
    cardId:    updated.card_id,
    projectId: updated.project_id,
    mentions:  mentionedStaffIds,
  };
}

/**
 * Soft-delete a card comment (sets deleted_at; never hard-deletes).
 */
export async function deleteComment(
  supabase: SC,
  commentId: string,
): Promise<DeleteCommentResult> {
  const { error } = await supabase
    .from("card_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
