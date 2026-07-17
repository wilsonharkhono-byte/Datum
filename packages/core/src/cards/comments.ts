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
 * Pure: extract all @<handle-or-first-name> tokens from a comment body.
 * Returns lowercase, deduplicated tokens (the leading @ is stripped).
 */
export function extractMentionTokens(body: string): string[] {
  return Array.from(new Set(
    (body.match(/@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g) ?? [])
      .map((m) => m.slice(1).toLowerCase()),
  ));
}

/** Roles whose RLS grants read on every project — always mentionable. */
const CROSS_PROJECT_READ_ROLES: ReadonlyArray<string> = ["principal", "admin", "estimator"];

/**
 * Resolve mention tokens to active staff IDs, scoped to people who can actually
 * open the card: active project members plus cross-project-read roles.
 *
 * Per token: a unique-handle match wins (Trello-username semantics); when no
 * handle matches, fall back to case-insensitive first-name matching (legacy
 * behavior — may resolve to several people who share the name).
 */
export async function resolveMentionStaffIds(
  supabase: SC,
  tokens: string[],
  projectId: string,
): Promise<string[]> {
  if (tokens.length === 0) return [];

  const [membersRes, staffRes] = await Promise.all([
    supabase
      .from("project_staff")
      .select("staff_id, active_until")
      .eq("project_id", projectId),
    supabase
      .from("staff")
      .select("id, full_name, handle, role")
      .eq("active", true),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const memberIds = new Set(
    (membersRes.data ?? [])
      .filter((m) => !m.active_until || m.active_until >= today)
      .map((m) => m.staff_id),
  );
  const eligible = (staffRes.data ?? []).filter(
    (s) => memberIds.has(s.id) || CROSS_PROJECT_READ_ROLES.includes(s.role),
  );

  const ids = new Set<string>();
  for (const token of tokens) {
    const handleMatch = eligible.find((s) => (s.handle ?? "").toLowerCase() === token);
    if (handleMatch) {
      ids.add(handleMatch.id);
      continue;
    }
    for (const s of eligible) {
      const first = (s.full_name ?? "").split(/\s+/)[0]?.toLowerCase();
      if (first && first === token) ids.add(s.id);
    }
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
  const mentionedStaffIds = await resolveMentionStaffIds(supabase, tokens, args.projectId);

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

  // Mention resolution is project-scoped, so read the comment's project first.
  const { data: existing, error: readErr } = await supabase
    .from("card_comments")
    .select("id, card_id, project_id")
    .eq("id", args.commentId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };
  if (!existing?.project_id) return { ok: false, error: "Komentar tidak ditemukan" };

  const tokens = extractMentionTokens(args.body);
  const mentionedStaffIds = await resolveMentionStaffIds(supabase, tokens, existing.project_id);

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
