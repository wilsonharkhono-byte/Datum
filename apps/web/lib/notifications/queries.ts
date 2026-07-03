// Thin re-export — implementation lives in @datum/core.
export { getRecentNotifications, getUnreadCount, type Notification } from "@datum/core";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { DIGEST_NOTIFICATION_KIND, DIGEST_LINK, type DigestNotificationCandidate } from "@/lib/assistant/daily-brief";

/**
 * Today's daily-digest notification candidates for the current caller
 * (Phase 3 Task 5 — completes T4's deferred /brief wiring). Narrowly scoped
 * — kind + link + a caller-supplied day window — rather than reusing
 * getRecentNotifications' unfiltered top-50, since the /brief page only
 * needs to know about today's digest, not the full notification feed.
 *
 * RLS-scoped: runs on the caller's own `supabase` client (notifications_select
 * only returns rows where recipient_staff_id = current_staff_id()), so this
 * can never surface another staff member's digest.
 */
export async function getTodaysDigestCandidates(
  supabase: SupabaseClient<Database>,
  todayStartIso: string,
  tomorrowStartIso: string,
): Promise<DigestNotificationCandidate[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, link, summary, read_at, created_at")
    .eq("kind", DIGEST_NOTIFICATION_KIND)
    .eq("link", DIGEST_LINK)
    .gte("created_at", todayStartIso)
    .lt("created_at", tomorrowStartIso)
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
