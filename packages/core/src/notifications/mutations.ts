import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { z } from "zod";

export const MarkReadInput = z.object({
  notificationId: z.string().uuid(),
});

export type MarkReadInput = z.infer<typeof MarkReadInput>;

export type NotificationResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a single notification as read by its ID.
 * Returns a discriminated result — never throws. Callers that need to throw
 * (e.g., react-query mutations) should check `result.ok`.
 */
export async function markNotificationRead(
  supabase: SupabaseClient<Database>,
  notificationId: string,
): Promise<NotificationResult> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Mark all unread notifications as read.
 * Returns a discriminated result — never throws.
 */
export async function markAllNotificationsRead(
  supabase: SupabaseClient<Database>,
): Promise<NotificationResult> {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
