import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Notification } from "@datum/db";

export type { Notification };

export async function getUnreadCount(supabase: SupabaseClient<Database>): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

export async function getRecentNotifications(
  supabase: SupabaseClient<Database>,
  limit = 50,
): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
