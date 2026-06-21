import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

type SC = SupabaseClient<Database>;

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const CardMemberRoleSchema = z.enum(["owner", "watcher", "assignee"]);
export type CardMemberRole = z.infer<typeof CardMemberRoleSchema>;

export const AddCardMemberInput = z.object({
  cardId:          z.string().uuid(),
  staffId:         z.string().uuid(),
  role:            CardMemberRoleSchema.default("watcher"),
  addedByStaffId:  z.string().uuid(),
});
export type AddCardMemberInputType = z.infer<typeof AddCardMemberInput>;

export const RemoveCardMemberInput = z.object({
  cardId:  z.string().uuid(),
  staffId: z.string().uuid(),
  role:    CardMemberRoleSchema,
});
export type RemoveCardMemberInputType = z.infer<typeof RemoveCardMemberInput>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type MemberResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Add a staff member to a card (upsert: un-removes a soft-removed row; otherwise
 * inserts a new row). Role defaults to "watcher" matching web behaviour.
 */
export async function addCardMember(
  supabase: SC,
  args: {
    cardId:         string;
    staffId:        string;
    role:           CardMemberRole;
    addedByStaffId: string;
  },
): Promise<MemberResult> {
  const parsed = AddCardMemberInput.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };
  const { cardId, staffId, role, addedByStaffId } = parsed.data;

  // Check for an existing (possibly soft-removed) row
  const { data: existing } = await supabase
    .from("card_members")
    .select("removed_at")
    .eq("card_id", cardId)
    .eq("staff_id", staffId)
    .eq("role", role)
    .maybeSingle();

  let dbErr: { message: string } | null = null;

  if (existing !== null && existing !== undefined) {
    // Un-remove the existing row
    const { error } = await supabase
      .from("card_members")
      .update({
        removed_at:        null,
        added_at:          new Date().toISOString(),
        added_by_staff_id: addedByStaffId,
      })
      .eq("card_id", cardId)
      .eq("staff_id", staffId)
      .eq("role", role);
    dbErr = error;
  } else {
    // Insert a new membership row
    const { error } = await supabase
      .from("card_members")
      .insert({
        card_id:           cardId,
        staff_id:          staffId,
        role,
        added_by_staff_id: addedByStaffId,
      });
    dbErr = error;
  }

  if (dbErr) return { ok: false, error: dbErr.message };
  return { ok: true };
}

/**
 * Soft-remove a staff member from a card (sets removed_at on the active row).
 */
export async function removeCardMember(
  supabase: SC,
  args: {
    cardId:  string;
    staffId: string;
    role:    CardMemberRole;
  },
): Promise<MemberResult> {
  const parsed = RemoveCardMemberInput.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };
  const { cardId, staffId, role } = parsed.data;

  const { error } = await supabase
    .from("card_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .eq("staff_id", staffId)
    .eq("role", role)
    .is("removed_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
